import test from 'node:test';
import assert from 'node:assert/strict';
import { evidenceClarification } from '../lib/evidence-clarification.js';

test('turns a strong but unverified source match into a grounded clarification', () => {
  const text = evidenceClarification({ title: 'Пресейл', section: '1.3' });
  assert.match(text, /раздел 1\.3 документа «Пресейл»/);
  assert.match(text, /Не хочу угадывать/);
});

test('does not create a clarification without a source location', () => {
  assert.equal(evidenceClarification({ title: 'Пресейл' }), null);
});
