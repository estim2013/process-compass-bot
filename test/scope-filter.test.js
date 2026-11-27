import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyScope, outOfScopeReply } from '../lib/scope-filter.js';

test('fast-gates clearly unrelated weather, currency and geography questions', () => {
  assert.equal(classifyScope('какая сегодня погода'), 'weather');
  assert.equal(classifyScope('сколько стоит доллар'), 'market');
  assert.equal(classifyScope('сколько сейчас стоит доллар?'), 'market');
  assert.equal(classifyScope('какой сегодня курс доллара?'), 'market');
  assert.equal(classifyScope('далеко ли до Таллина'), 'geography');
});

test('does not gate questions that connect the same words to corporate work', () => {
  assert.equal(classifyScope('какой курс доллара заложен в договоре?'), null);
  assert.equal(classifyScope('как оформить командировку в Таллин?'), null);
  assert.equal(classifyScope('какая погода доставки по внутреннему регламенту?'), null);
});

test('off-topic response explains scope with a light tone', () => {
  assert.match(outOfScopeReply('geography'), /глобус заканчивается на корпоративной базе/);
  assert.match(outOfScopeReply('market'), /котировок нет/);
});
