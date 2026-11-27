export function normalizeComparable(value) {
  const decimalMark = '\uE000';
  let text = String(value || '').replace(/ё/gi, match => match === 'Ё' ? 'Е' : 'е').toLowerCase();
  text = text.replace(/(?<=\d)[,.](?=\d)/g, decimalMark);
  return text
    .replace(/[-‐‑‒–—]/g, ' ')
    .replace(/[^\p{L}\p{N}\s\uE000]/gu, ' ')
    .replace(/\uE000/g, '.')
    .replace(/\s+/g, ' ')
    .trim();
}

function numericFacts(text) {
  const source = String(text || '').replace(/^\s*\d+(?:\.\d+)+\.?\s+(?=[A-ZА-ЯЁ])/u, ' ');
  const value = normalizeComparable(source);
  const facts = new Set((value.match(/\b\d+(?:[.,]\d+)?\b/g) || []).map(x => x.replace(',', '.')));
  const words = {
    один: '1', одна: '1', одну: '1', одного: '1', одном: '1', одной: '1',
    два: '2', две: '2', двух: '2', двумя: '2',
    три: '3', трех: '3', трёх: '3', трем: '3', тремя: '3',
    четыре: '4', четырех: '4', четырем: '4', четырём: '4', четырьмя: '4',
    пять: '5', пяти: '5', пятью: '5',
    шесть: '6', шести: '6', шестью: '6',
    семь: '7', семи: '7', семью: '7',
    восемь: '8', восьми: '8', девять: '9', девяти: '9', десять: '10', десяти: '10'
  };
  for (const word of value.split(/\s+/)) if (words[word]) facts.add(words[word]);
  if (/полгода/.test(value)) facts.add('6');
  return facts;
}

function hasUnicodeWord(text, word) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'u').test(text);
}

function hasUnicodeWordPrefix(text, prefix) {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}\\p{L}*(?![\\p{L}\\p{N}])`, 'u').test(text);
}

function hasUnicodePhrase(text, phrase) {
  const pattern = phrase.split(/\s+/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
  return new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, 'u').test(text);
}

const mandatoryPattern = /(?<![\p{L}\p{N}])(?:обязан(?:а|о|ы)?|обязател(?:ен|ьна|ьно|ьны|ьный|ьная|ьное|ьные|ьных|ьным|ьными|ьную)|долж(?:ен|на|но|ны)|необходим\p{L}*|требу(?:ется|ются)|нужно|надо)(?![\p{L}\p{N}])/u;
const notRequiredPattern = /(?<![\p{L}\p{N}])(?:необязател\p{L}*|ненужн\p{L}*|не(?:\s+(?:является|являются|считается|считаются|будет))?\s+(?:обязан(?:а|о|ы)?|обязател(?:ен|ьна|ьно|ьны|ьный|ьная|ьное|ьные|ьных|ьным|ьными|ьную)|необходим\p{L}*|требу(?:ется|ются)|нужно|надо|обязательно))(?![\p{L}\p{N}])/u;
const negatedShouldPattern = /(?<![\p{L}\p{N}])не\s+долж(?:ен|на|но|ны)(?![\p{L}\p{N}])/gu;
const workingDaysPattern = /(?<![\p{L}\p{N}])рабоч\p{L}*\s+(?:день|дня|дней|дни|днем|днями|дн\p{L}*)(?![\p{L}\p{N}])/u;
const dayWordPattern = /(?<![\p{L}\p{N}])(?:день|дня|дней|дни|днем|днями|дн\p{L}*)(?![\p{L}\p{N}])/u;
const prohibitionPattern = /(?<![\p{L}\p{N}])(?:не\s+допуска\p{L}*|нельзя|запрещ\p{L}*|не\s+долж(?:ен|на|но|ны))(?![\p{L}\p{N}])/u;

export function validateClaim(claim, sourceText) {
  const statement = normalizeComparable(claim);
  const evidence = normalizeComparable(sourceText);
  const sourceNumbers = numericFacts(sourceText);
  for (const number of numericFacts(claim)) {
    if (!sourceNumbers.has(number)) throw new Error(`Число ${number} в ответе не подтверждено опорным фрагментом`);
  }

  const sourceRecommends = /рекоменд|желательно|целесообразно/.test(evidence);
  const sourceNotRequired = notRequiredPattern.test(evidence);
  const claimNotRequired = notRequiredPattern.test(statement);
  const positiveMandatoryStatement=statement.replace(negatedShouldPattern,' ');
  const mandatoryClaim = mandatoryPattern.test(positiveMandatoryStatement) && !claimNotRequired;
  if (sourceRecommends && mandatoryClaim) {
    throw new Error('Ответ превратил рекомендацию источника в обязательное требование');
  }
  if (claimNotRequired && !sourceRecommends && !sourceNotRequired) {
    throw new Error('Ответ утверждает, что действие необязательно, но источник этого не подтверждает');
  }
  if (sourceNotRequired && !claimNotRequired) {
    throw new Error('В ответе потеряно указание, что действие необязательно');
  }

  if (workingDaysPattern.test(evidence) && dayWordPattern.test(statement) && !hasUnicodeWordPrefix(statement, 'рабоч')) {
    throw new Error('В ответе потеряно условие «рабочие дни»');
  }
  if (hasUnicodePhrase(evidence, 'только если') && !hasUnicodePhrase(statement, 'только если')) {
    throw new Error('В ответе потеряно условие «только если»');
  }
  if (hasUnicodePhrase(evidence, 'при условии') && !hasUnicodePhrase(statement, 'при условии')) {
    throw new Error('В ответе потеряно условие «при условии»');
  }
  if (hasUnicodeWord(evidence, 'если') && !hasUnicodeWord(statement, 'если') && !hasUnicodePhrase(statement, 'при условии')) {
    throw new Error('В ответе пропущено условие применимости правила');
  }

  if (prohibitionPattern.test(evidence) !== prohibitionPattern.test(statement)) {
    throw new Error('Нельзя подтвердить модальность или отрицание ответа');
  }
}
