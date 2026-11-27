import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeComparable, validateClaim } from '../lib/claim-validation.js';

test('preserves working-day qualifiers in Russian inflections', () => {
  assert.throws(
    () => validateClaim('Ответьте за 3 дня', 'Ответьте в течение трех рабочих дней'),
    /рабочие дни/
  );
  assert.doesNotThrow(() => validateClaim('Ответьте за 3 рабочих дня', 'Ответьте в течение трех рабочих дней'));
  assert.throws(
    () => validateClaim('Ответьте за 1 день', 'Ответьте за 1 рабочий день'),
    /рабочие дни/
  );
});

test('keeps decimal values as one numeric fact', () => {
  assert.equal(normalizeComparable('1,5 дня'), '1.5 дня');
  assert.doesNotThrow(() => validateClaim('Срок 1,5 месяца', 'Срок 1.5 месяца'));
  assert.throws(() => validateClaim('Срок 5 дней', 'Срок 1.5 рабочих дня'), /Число 5/);
});

test('does not mistake the noun “обязанности” for a mandatory instruction', () => {
  assert.doesNotThrow(() => validateClaim('В документе перечислены обязанности сотрудника', 'Рекомендуется указать обязанности сотрудника'));
  assert.doesNotThrow(() => validateClaim('Срок не является обязательным требованием', 'Срок рекомендуется планировать заранее'));
  assert.throws(() => validateClaim('Срок не является обязательным', 'Срок обязателен'), /необязательно/);
  assert.doesNotThrow(() => validateClaim('Срок не обязателен', 'Срок рекомендуется планировать заранее'));
  assert.throws(() => validateClaim('Анкета обязательна', 'Анкета необязательна'), /необязательно/);
  assert.throws(() => validateClaim('Анкета необязательна', 'Анкета обязательна'), /необязательно/);
});

test('keeps a prohibition distinct from the absence of an obligation', () => {
  assert.doesNotThrow(() => validateClaim(
    'Подрядчика нельзя объявлять победителем до проверки службы безопасности',
    'Подрядчик не должен объявляться победителем до проверки службы безопасности'
  ));
  assert.throws(() => validateClaim('Подрядчик не обязан проходить проверку', 'Подрядчик должен пройти проверку'), /необязательно/);
});

test('recognizes number words after ё normalization', () => {
  assert.doesNotThrow(() => validateClaim('Потребуется 4 рабочих дня', 'Нужно четырём рабочим дням уделить внимание'));
});

test('preserves conditional rules', () => {
  assert.throws(() => validateClaim('Отправьте заявку', 'Если данные неполные, отправьте заявку на уточнение'), /условие/);
  assert.doesNotThrow(() => validateClaim('Если данные неполные, отправьте заявку', 'Если данные неполные, отправьте заявку на уточнение'));
  assert.throws(() => validateClaim('Отправьте заявку при условии готовности данных', 'Подавать только если данные готовы'), /только если/);
});
