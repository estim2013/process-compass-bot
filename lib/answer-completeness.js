const normalize = value => String(value || '').toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

const rolePattern=/(?<![\p{L}\p{N}])(?:аккаунт менеджер|бизнес девелопмент менеджер|пресейл архитектор|ресурс менеджер|руководител\p{L}*|координатор\p{L}*|менеджер\p{L}*|архитектор\p{L}*|специалист\p{L}*|сотрудник\p{L}*|первая линия|1 линия|ам|ап|bdm|па|рп|рм|ss|tps|tss)(?![\p{L}\p{N}])/gu;

function roleMentions(text){
  const matches=[...text.matchAll(rolePattern)].map(match=>({start:match.index,end:match.index+match[0].length}));
  let count=0,lastEnd=-100;
  for(const match of matches){if(match.start-lastEnd>24)count++;lastEnd=Math.max(lastEnd,match.end);}
  return count;
}

function missingFacets(question, claims) {
  const q=normalize(question), answer=normalize((claims||[]).map(claim=>claim.text).join(' '));
  const missing=[];
  const agents=[...q.matchAll(/(?<![\p{L}\p{N}])(?:кто|кого|кому|кем)(?![\p{L}\p{N}])/gu)];
  if(agents.length){
    const answeredRoles=roleMentions(answer);
    if(answeredRoles<agents.length)missing.push('назвать каждого запрошенного ответственного или исполнителя');
  }
  if(/какие условия|при каких условиях|что должно быть выполнено|какие требования|какие критерии/u.test(q)){
    const criteria=[/подпис/u,/оплат/u,/анкетир/u,/сдач/u,/получ/u,/провед/u,/соглас/u,/заверш/u,/предостав/u,/налич/u,/отсутств/u,/срок/u,/документ/u,/акт/u].filter(pattern=>pattern.test(answer)).length;
    if(criteria<3)missing.push('перечислить все запрошенные условия или критерии');
  }
  if(/какие (?:исходные )?(?:материал|документ|данные)|что (?:нужно|необходимо|надо) приложить|что прикладывать/u.test(q)){
    const materialTerms=[/опросник|анкет/u,/техническ задан/u,/\bтз\b/u,/спецификац/u,/исходн данн/u,/дополнительн материал/u,/техник документац/u].filter(pattern=>pattern.test(answer)).length;
    if(materialTerms<2)missing.push('перечислить требуемые исходные документы и материалы');
  }
  return missing;
}

export function missingAnswerFacets(question, claims) {
  return missingFacets(question, claims);
}
