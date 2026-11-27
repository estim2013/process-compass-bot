import test from 'node:test';
import assert from 'node:assert/strict';
import { missingAnswerFacets } from '../lib/answer-completeness.js';

test('detects an unanswered responsible-person part',()=>{
  assert.deepEqual(missingAnswerFacets('Кого подключают к экзотическому проекту?',[
    {text:'Это делают для проработки новой услуги и поиска подрядчика.'}
  ]),['назвать каждого запрошенного ответственного или исполнителя']);
});

test('does not mistake a role abbreviation for a second person',()=>{
  assert.deepEqual(missingAnswerFacets('Кто закрывает проект?',[
    {text:'Закрытие выполняет Руководитель проекта (РП).'}
  ]),[]);
});

test('detects missing parts of compound responsibility questions',()=>{
  assert.deepEqual(missingAnswerFacets('Кто управляет рисками проекта и кто отвечает за технические риски?',[
    {text:'За проект отвечает Руководитель проекта (РП).'}
  ]),['назвать каждого запрошенного ответственного или исполнителя']);
});

test('detects an incomplete list of requested closure conditions',()=>{
  assert.deepEqual(missingAnswerFacets('Кто закрывает проект и какие условия должны быть выполнены?',[
    {text:'Закрывает проект Руководитель проекта. Для закрытия нужно сдать работы и подписать акт.'}
  ]),['перечислить все запрошенные условия или критерии']);
});

test('detects missing requested source materials',()=>{
  assert.deepEqual(missingAnswerFacets('Какие исходные материалы должны быть в заявке?',[
    {text:'В заявке указывают описание бизнес-задачи и требуемый результат.'}
  ]),['перечислить требуемые исходные документы и материалы']);
});
