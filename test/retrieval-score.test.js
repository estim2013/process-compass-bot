import test from 'node:test';
import assert from 'node:assert/strict';
import { hybridRetrievalScore } from '../lib/retrieval-score.js';

test('exact lexical coverage can lift the matching passage above a semantic-only neighbor', () => {
  const exact = hybridRetrievalScore(1, 180, 0.65);
  const semanticNeighbor = hybridRetrievalScore(12, 1, 0.24);
  assert.ok(exact > semanticNeighbor);
});

test('coverage input is bounded and missing ranks are safe', () => {
  assert.equal(hybridRetrievalScore(null, null, 2), 0.03);
  assert.equal(hybridRetrievalScore(null, null, -1), 0);
});
