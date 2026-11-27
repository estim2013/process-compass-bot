import test from 'node:test';
import assert from 'node:assert/strict';
import { retryGuidance } from '../lib/retry-guidance.js';

test('gives concise evidence-specific guidance after a failed exact-span check', () => {
  const text = retryGuidance({ stage: 'evidence_binding', code: 'span_not_found' });
  assert.match(text, /дословно скопируй/);
  assert.match(text, /именно выбранного source_ref/);
});

test('preserves conditions and modality instead of weakening claim validation', () => {
  assert.match(retryGuidance({ stage: 'claim_validation', code: 'condition_mismatch' }), /все условия применимости/);
  assert.match(retryGuidance({ stage: 'claim_validation', code: 'working_day_condition_mismatch' }), /рабочих днях или часах/);
  assert.match(retryGuidance({ stage: 'claim_validation', code: 'if_condition_mismatch' }), /условие применимости/);
  assert.match(retryGuidance({ stage: 'claim_validation', code: 'modality_mismatch' }), /модальность источника/);
});

test('uses a compact general recovery instruction for unclassified failures', () => {
  assert.match(retryGuidance({ stage: 'model_output', code: 'invalid_json' }), /одного-двух утверждений/);
});

test('addresses answer length and unsupported numeric inference as separate failure classes', () => {
  assert.match(retryGuidance({ stage: 'model_output', code: 'evidence_too_long' }), /не длиннее 320 символов/);
  assert.match(retryGuidance({ stage: 'claim_validation', code: 'numeric_mismatch' }), /направление сравнения/);
});
