import test from 'node:test';
import assert from 'node:assert/strict';
import { expandProcessSearchQuery } from '../lib/search-aliases.js';

test('expands everyday selection wording into role assignment and criteria language',()=>{
  const query='Как выбирают ПА для расчёта по заявке?';
  const expanded=expandProcessSearchQuery(query);
  assert.ok(expanded.startsWith(query));
  assert.match(expanded,/сотрудник первой линии/);
  assert.match(expanded,/отчет загрузки наименее загруженного исполнителя/);
});

test('leaves unrelated questions unchanged',()=>{
  assert.equal(expandProcessSearchQuery('Сколько длится согласование?'),'Сколько длится согласование?');
});

test('maps appointment questions to the regulation wording for role ownership',()=>{
  assert.match(expandProcessSearchQuery('Кто назначает пресейл-архитектора в Технической дирекции?'),/ресурсный менеджер/);
});
