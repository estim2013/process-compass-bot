import test from 'node:test';
import assert from 'node:assert/strict';
import { selectAnswerContext } from '../lib/answer-context.js';

test('answer context preserves the best result from each unit before filling by rank', () => {
  const sources = [
    { id: 'a', unit: 'A' },
    { id: 'a', unit: 'A' },
    { id: 'b', unit: 'B' },
    { id: 'c', unit: 'C' },
    { id: 'a', unit: 'A' },
  ];
  assert.deepEqual(selectAnswerContext(sources, 3), [sources[0], sources[2], sources[3]]);
});

test('answer context keeps the twelve strongest sources in ranked order by default', () => {
  const sources = Array.from({ length: 20 }, (_, i) => ({ id: `doc-${i}`, section: `${i}` }));
  assert.deepEqual(selectAnswerContext(sources), sources.slice(0, 12));
});

test('answer context handles empty input and an invalid limit safely', () => {
  assert.deepEqual(selectAnswerContext([]), []);
  assert.deepEqual(selectAnswerContext([{ id: 'a' }], 0), []);
});
