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

test('classifies malformed and structurally incomplete model output separately',()=>{
  code('{"decision":','model_output','invalid_json');
  code(JSON.stringify({...base,decision:'maybe'}),'model_output','schema_violation');
  const missingField={...base,claims:[{text:'Утверждение',source_ref:1}]};
  code(JSON.stringify(missingField),'model_output','missing_claim_fields');
});

test('classifies evidence binding separately from numeric and modality failures',()=>{
  code(JSON.stringify({...base,claims:[{...base.claims[0],evidence:''}]}),'evidence_binding','missing_evidence_span');
  code(JSON.stringify({...base,claims:[{...base.claims[0],evidence:'В другом регламенте написано иначе'}]}),'evidence_binding','span_not_found');
  code(JSON.stringify({...base,claims:[{...base.claims[0],source_ref:2}]}),'evidence_binding','source_ref_out_of_range');
  code(JSON.stringify({...base,claims:[{...base.claims[0],text:'Срок составляет 5 дней.'}]}),'claim_validation','numeric_mismatch');
  code(JSON.stringify({...base,claims:[{...base.claims[0],text:'Описание проекта можно не указывать.'}]}),'claim_validation','modality_mismatch');
});

