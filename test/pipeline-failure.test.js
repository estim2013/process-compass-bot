import test from 'node:test';
import assert from 'node:assert/strict';
import { PipelineFailure, classifyRetryOutcome, classifyTransportFailure, safeFailureCode } from '../lib/pipeline-failure.js';

test('keeps pipeline diagnostics categorical and excludes exception text',()=>{
  const error=new PipelineFailure('model_output','invalid_json','private raw output must not escape');
  assert.deepEqual(safeFailureCode(error),{stage:'model_output',code:'invalid_json'});
  assert.deepEqual(safeFailureCode(new Error('private question text')),{stage:'answer_pipeline',code:'unexpected_error'});
});

test('classifies retry outcome from first and final attempt codes',()=>{
  assert.equal(classifyRetryOutcome([],false),null);
  assert.equal(classifyRetryOutcome([{stage:'model_output',code:'invalid_json'}],false),'not_retried');
  assert.equal(classifyRetryOutcome([{stage:'model_output',code:'invalid_json'}],true),'recovered');
  assert.equal(classifyRetryOutcome([{stage:'claim_validation',code:'numeric_mismatch'},{stage:'claim_validation',code:'numeric_mismatch'}],false),'same_failure');
  assert.equal(classifyRetryOutcome([{stage:'model_transport',code:'timeout'},{stage:'evidence_binding',code:'span_not_found'}],false),'different_failure');
  assert.equal(classifyRetryOutcome([{stage:'model_transport',code:'timeout'},{stage:'model_transport',code:'http_5xx'}],false),'failed_transport');
});

test('maps transport failures from the failure boundary without relying on error prose',()=>{
  assert.equal(classifyTransportFailure({errorName:'TimeoutError'}),'timeout');
  assert.equal(classifyTransportFailure({errorName:'AbortError'}),'timeout');
  assert.equal(classifyTransportFailure({errorName:'TypeError'}),'connection_error');
  assert.equal(classifyTransportFailure({status:429}),'http_429');
  assert.equal(classifyTransportFailure({status:503}),'http_5xx');
  assert.equal(classifyTransportFailure({status:401}),'http_error');
});

