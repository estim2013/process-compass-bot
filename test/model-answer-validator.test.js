import test from 'node:test';
import assert from 'node:assert/strict';
import { validateModelAnswer } from '../lib/model-answer-validator.js';
import { PipelineFailure } from '../lib/pipeline-failure.js';

const sources=[{excerpt:'Заявка на пресейл должна содержать описание проекта и сроки.'}];
const base={decision:'answer',intent_clear:true,intent_summary:'Состав заявки',claims:[{text:'В заявке указывают описание проекта.',source_ref:1,evidence:'Заявка на пресейл должна содержать описание проекта'}]};
const code=(raw, expectedStage, expectedCode)=>assert.throws(
  ()=>validateModelAnswer(raw,sources),
  error=>error instanceof PipelineFailure&&error.stage===expectedStage&&error.code===expectedCode
);

test('accepts a valid claim only when its evidence is an exact source substring',()=>{
  const result=validateModelAnswer(JSON.stringify(base),sources);
  assert.equal(result.answer,'В заявке указывают описание проекта. [1]');
  assert.deepEqual(result.citation_refs,[1]);
});

test('rebinds an exact evidence quote to its unique matching source',()=>{
  const result=validateModelAnswer(JSON.stringify({...base,claims:[{...base.claims[0],source_ref:2}]}),[
    {excerpt:'Заявка на пресейл должна содержать описание проекта',section:'1.1'},
    {excerpt:'Заявка должна содержать иные сведения',section:'1.2'}
  ]);
  assert.equal(result.claims[0].source_ref,1);
  assert.deepEqual(result.citation_refs,[1]);
});

test('does not guess a source when an exact evidence quote occurs in multiple fragments',()=>{
  assert.throws(()=>validateModelAnswer(JSON.stringify({...base,claims:[{...base.claims[0],source_ref:2}]}),[
    {excerpt:'Заявка на пресейл должна содержать описание проекта',section:'1.1'},
    {excerpt:'Заявка должна содержать иные сведения',section:'1.2'},
    {excerpt:'Заявка на пресейл должна содержать описание проекта',section:'1.3'}
  ]),error=>error instanceof PipelineFailure&&error.stage==='evidence_binding'&&error.code==='span_not_found');
});

test('keeps independently verified claims when another claim fails validation',()=>{
  const result=validateModelAnswer(JSON.stringify({...base,claims:[
    base.claims[0],
    {text:'Срок составляет 5 дней.',source_ref:1,evidence:'Заявка на пресейл должна содержать описание проекта'}
  ]}),sources);
  assert.equal(result.partial,true);
  assert.equal(result.claims.length,1);
  assert.equal(result.answer,'В заявке указывают описание проекта. [1]');
  assert.deepEqual(result.citation_refs,[1]);
  assert.deepEqual(result.rejected_claims,[{stage:'claim_validation',code:'numeric_mismatch'}]);
});

test('classifies malformed and structurally incomplete model output separately',()=>{
  code('{"decision":','model_output','invalid_json');
  code(JSON.stringify({...base,decision:'maybe'}),'model_output','schema_violation');
  const missingField={...base,claims:[{text:'Утверждение',source_ref:1}]};
  code(JSON.stringify(missingField),'model_output','missing_claim_fields');
});

test('rejects oversized answer fields so unconstrained output cannot consume the token budget',()=>{
  code(JSON.stringify({...base,intent_summary:'x'.repeat(181)}),'model_output','missing_intent_fields');
  code(JSON.stringify({...base,claims:[{...base.claims[0],text:'x'.repeat(281)}]}),'model_output','claim_too_long');
  code(JSON.stringify({...base,claims:[{...base.claims[0],evidence:'x'.repeat(321)}]}),'model_output','evidence_too_long');
});

test('classifies evidence binding separately from numeric and modality failures',()=>{
  code(JSON.stringify({...base,claims:[{...base.claims[0],evidence:''}]}),'evidence_binding','missing_evidence_span');
  code(JSON.stringify({...base,claims:[{...base.claims[0],evidence:'В другом регламенте написано иначе'}]}),'evidence_binding','span_not_found');
  code(JSON.stringify({...base,claims:[{...base.claims[0],source_ref:2}]}),'evidence_binding','source_ref_out_of_range');
  code(JSON.stringify({...base,claims:[{...base.claims[0],text:'Срок составляет 5 дней.'}]}),'claim_validation','numeric_mismatch');
  code(JSON.stringify({...base,claims:[{...base.claims[0],text:'Описание проекта можно не указывать.'}]}),'claim_validation','modality_mismatch');
});
