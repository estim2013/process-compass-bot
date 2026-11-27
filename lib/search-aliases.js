import { normalizeComparable } from './claim-validation.js';

export function expandProcessSearchQuery(question) {
  const text=normalizeComparable(question);
  const asksForSelection=/(?:выбира|подбира|определя)\p{L}*/iu.test(text);
  const namesRole=/(?:пресейл архитектор|архитектор|специалист|исполнитель|ответственн|(?<![\p{L}\p{N}])(?:па|tss|tps|рп|рм)(?![\p{L}\p{N}]))/iu.test(text);
  if(!asksForSelection||!namesRole)return String(question||'');
  return `${question} назначение назначает ответственным по заявке сотрудник первой линии`;
}
