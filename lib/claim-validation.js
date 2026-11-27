import { pipelineFailure } from './pipeline-failure.js';

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
const notRequiredPattern = /(?<![\p{L}\p{N}])(?:необязател\p{L}*|ненужн\p{L}*|можно\s+не\s+(?:указывать|прилагать|прикладывать|предоставлять|направлять|заполнять|согласовывать|оформлять|создавать|проводить|выполнять|подписывать|передавать|указывать|прикреплять)\p{L}*|не(?:\s+(?:является|являются|считается|считаются|будет))?\s+(?:обязан(?:а|о|ы)?|обязател(?:ен|ьна|ьно|ьны|ьный|ьная|ьное|ьные|ьных|ьным|ьными|ьную)|необходим\p{L}*|требу(?:ется|ются)|нужно|надо|обязательно))(?![\p{L}\p{N}])/u;
const negatedShouldPattern = /(?<![\p{L}\p{N}])не\s+долж(?:ен|на|но|ны)(?![\p{L}\p{N}])/gu;
const workingDaysPattern = /(?<![\p{L}\p{N}])рабоч\p{L}*\s+(?:день|дня|дней|дни|днем|днями|дн\p{L}*)(?![\p{L}\p{N}])/u;
const dayWordPattern = /(?<![\p{L}\p{N}])(?:день|дня|дней|дни|днем|днями|дн\p{L}*)(?![\p{L}\p{N}])/u;
const prohibitionPattern = /(?<![\p{L}\p{N}])(?:не\s+допуска\p{L}*|нельзя|запрещ\p{L}*|не\s+долж(?:ен|на|но|ны))(?![\p{L}\p{N}])/u;
const conditionMarkerPattern = /(?<![\p{L}\p{N}])(?:если|когда|в\s+случае|при\s+условии|при\s+(?:наруш\p{L}*|несоблюден\p{L}*|налич\p{L}*|отсутств\p{L}*|необходимост\p{L}*|возникновен\p{L}*|поступлен\p{L}*|выполнен\p{L}*|недостаточност\p{L}*|изменен\p{L}*|получен\p{L}*|предоставлен\p{L}*))(?![\p{L}\p{N}])/u;
const inabilityPattern = /(?<![\p{L}\p{N}])(?:не\s+может(?:\s+быть)?|невозможн\p{L}*|нельзя\s+ни)(?![\p{L}\p{N}])/u;

export function validateClaim(claim, sourceText) {
  const statement = normalizeComparable(claim);
  const evidence = normalizeComparable(sourceText);
  const sourceNumbers = numericFacts(sourceText);
  for (const number of numericFacts(claim)) {
    if (!sourceNumbers.has(number)) throw pipelineFailure('claim_validation', 'numeric_mismatch', `Число ${number} в ответе не подтверждено опорным фрагментом`);
  }

  const sourceRecommends = /рекоменд|желательно|целесообразно/.test(evidence);
  const sourceNotRequired = notRequiredPattern.test(evidence);
  const claimNotRequired = notRequiredPattern.test(statement);
  const positiveMandatoryStatement=statement.replace(negatedShouldPattern,' ');
  const mandatoryClaim = mandatoryPattern.test(positiveMandatoryStatement) && !claimNotRequired;
  if (sourceRecommends && mandatoryClaim) {
    throw pipelineFailure('claim_validation', 'modality_mismatch', 'Ответ превратил рекомендацию источника в обязательное требование');
  }
  if (claimNotRequired && !sourceRecommends && !sourceNotRequired) {
    throw pipelineFailure('claim_validation', 'modality_mismatch', 'Ответ утверждает, что действие необязательно, но источник этого не подтверждает');
  }
  if (sourceNotRequired && !claimNotRequired) {
    throw pipelineFailure('claim_validation', 'modality_mismatch', 'В ответе потеряно указание, что действие необязательно');
  }

  if (workingDaysPattern.test(evidence) && dayWordPattern.test(statement) && !hasUnicodeWordPrefix(statement, 'рабоч')) {
    throw pipelineFailure('claim_validation', 'working_day_condition_mismatch', 'В ответе потеряно условие «рабочие дни»');
  }
  if (hasUnicodePhrase(evidence, 'только если') && !hasUnicodePhrase(statement, 'только если')) {
    throw pipelineFailure('claim_validation', 'only_if_condition_mismatch', 'В ответе потеряно условие «только если»');
  }
  if (hasUnicodePhrase(evidence, 'при условии') && !hasUnicodePhrase(statement, 'при условии')) {
    throw pipelineFailure('claim_validation', 'provided_that_condition_mismatch', 'В ответе потеряно условие «при условии»');
  }
  if (hasUnicodeWord(evidence, 'если') && !conditionMarkerPattern.test(statement)) {
    throw pipelineFailure('claim_validation', 'if_condition_mismatch', 'В ответе пропущено условие применимости правила');
  }

  const sourceProhibition = prohibitionPattern.test(evidence) && !inabilityPattern.test(evidence);
  const claimProhibition = prohibitionPattern.test(statement) && !inabilityPattern.test(statement);
  if (sourceProhibition !== claimProhibition) {
    throw pipelineFailure('claim_validation', 'modality_mismatch', 'Нельзя подтвердить модальность или отрицание ответа');
  }
}
