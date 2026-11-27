import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyRequestOutcome } from '../lib/failure-class.js';

test('keeps unrelated questions, retrieval misses, model refusals and pipeline failures distinct',()=>{
  assert.equal(classifyRequestOutcome('out_of_scope','OUT_OF_SCOPE'),'out_of_scope');
  assert.equal(classifyRequestOutcome('escalation','NO_CANDIDATES'),'retrieval_miss');
  assert.equal(classifyRequestOutcome('escalation','NO_SUPPORTED_ANSWER'),'model_no_answer');
  assert.equal(classifyRequestOutcome('escalation','MODEL_CALL_OR_VALIDATION_ERROR',[{stage:'claim_validation',code:'numeric_mismatch'}]),'claim_validation:numeric_mismatch');
  assert.equal(classifyRequestOutcome('partial_answer','PARTIAL_VALIDATED_CLAIMS'),'partial_answer');
});
