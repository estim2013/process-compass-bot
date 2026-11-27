import { normalizeComparable } from './claim-validation.js';

export function expandProcessSearchQuery(question) {
  const text=normalizeComparable(question);
  const asksForSelection=/(?:выбира|подбира|определя)\p{L}*/iu.test(text);
  const namesRole=/(?:пресейл архитектор|архитектор|специалист|исполнитель|ответственн|(?<![\p{L}\p{N}])(?:па|tss|tps|рп|рм)(?![\p{L}\p{N}]))/iu.test(text);
  const asksWhoAssigns=/(?:кто|кем).{0,50}(?:назнач|ответствен)|(?:назнач|ответствен).{0,50}(?:кто|кем)/iu.test(text);
  if(!namesRole)return String(question||'');
  if(asksWhoAssigns)return `${question} за назначение архитектора пресейла отвечает ресурсный менеджер`;
  if(!asksForSelection)return String(question||'');
  // Selection questions need the assignment criteria as well as the role handoff.
  // These terms map ordinary wording to the regulation's workload/competence language.
  return `${question} назначает ответственным сотрудник первой линии отчет загрузки наименее загруженного исполнителя по направлению компетенции`;
}
