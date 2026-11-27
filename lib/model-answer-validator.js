import { normalizeComparable, validateClaim } from './claim-validation.js';
import { pipelineFailure } from './pipeline-failure.js';

export function validateModelAnswer(raw, sources, normalizeText = normalizeComparable) {
  let result;
  try { result = JSON.parse(raw); }
  catch (error) { throw pipelineFailure('model_output', 'invalid_json', 'Structured answer is not valid JSON', { cause: error }); }

  if (!result || typeof result !== 'object' || !['answer', 'clarify', 'no_answer'].includes(result.decision)) {
    throw pipelineFailure('model_output', 'schema_violation', 'Некорректный тип ответа модели');
  }
  if (typeof result.intent_clear !== 'boolean' || typeof result.intent_summary !== 'string' || !result.intent_summary.trim() || result.intent_summary.length > 180) {
    throw pipelineFailure('model_output', 'missing_intent_fields', 'Нет подтверждённой формулировки намерения');
  }
  if (!result.intent_clear && result.decision !== 'clarify') {
    throw pipelineFailure('model_output', 'schema_violation', 'Ответ сформирован при неясном намерении');
  }

  if (result.decision === 'answer') {
    if (!Array.isArray(result.claims)) throw pipelineFailure('model_output', 'missing_claims', 'Ответ модели не содержит проверяемых утверждений');
    if (result.claims.length > 6) throw pipelineFailure('model_output', 'schema_violation', 'Ответ содержит слишком много утверждений для проверки');
    if (!result.claims.length) throw pipelineFailure('model_output', 'missing_claims', 'Ответ модели не содержит проверяемых утверждений');
    const validClaims = [], rejectedClaims = [];
    for (const claim of result.claims) {
      try {
        if (!claim || typeof claim.text !== 'string' || !claim.text.trim() || !Number.isInteger(claim.source_ref) || typeof claim.evidence !== 'string') {
          throw pipelineFailure('model_output', 'missing_claim_fields', 'Не хватает обязательных полей утверждения');
        }
        if (claim.text.length > 280) throw pipelineFailure('model_output', 'claim_too_long', 'Текст утверждения превышает установленный объём');
        if (claim.evidence.length > 320) throw pipelineFailure('model_output', 'evidence_too_long', 'Опорный фрагмент превышает установленный объём');
        if (claim.source_ref < 1 || claim.source_ref > sources.length) {
          throw pipelineFailure('evidence_binding', 'source_ref_out_of_range', 'Источник утверждения отсутствует среди найденных фрагментов');
        }
        const evidence = claim.evidence.trim();
        const evidenceWords = normalizeText(evidence).split(/\s+/).filter(word => word.length >= 3);
        if (evidenceWords.length < 3) throw pipelineFailure('evidence_binding', 'missing_evidence_span', 'Опорный фрагмент пуст или слишком короткий');
        const normalizedEvidence = normalizeComparable(evidence);
        const normalizedSource = normalizeComparable(sources[claim.source_ref - 1].excerpt);
        if (!normalizedSource.includes(normalizedEvidence)) {
          // The model can cite the right exact quote with the adjacent source number.
          // Rebind only when that literal quote occurs in exactly one supplied source.
          const matchingRefs = sources.flatMap((source, index) =>
            normalizeComparable(source.excerpt).includes(normalizedEvidence) ? [index + 1] : []
          );
          if (matchingRefs.length !== 1) throw pipelineFailure('evidence_binding', 'span_not_found', 'Опора ответа не найдена однозначно в документе');
          claim.source_ref = matchingRefs[0];
        }
        validateClaim(claim.text, evidence);
        validClaims.push(claim);
      } catch (error) {
        if (!(error?.stage && error?.code)) throw error;
        rejectedClaims.push({ stage: error.stage, code: error.code });
      }
    }
    // A bad claim must not poison independently supported claims. Keep only claims
    // that passed the same exact-span and numeric/modality checks as a full answer.
    if (!validClaims.length) {
      const first = rejectedClaims[0] || { stage: 'model_output', code: 'claims_rejected' };
      throw pipelineFailure(first.stage, first.code, 'Ни одно утверждение не прошло проверку источников');
    }
    const refs = [...new Set(validClaims.map(claim => claim.source_ref))];
    return {
      ...result,
      claims: validClaims,
      citation_refs: refs,
      partial: rejectedClaims.length > 0,
      rejected_claims: rejectedClaims,
      answer: validClaims.map(claim => `${claim.text.trim()} [${claim.source_ref}]`).join(' ')
    };
  }

  if (result.decision === 'clarify' && (typeof result.clarifying_question !== 'string' || !result.clarifying_question.trim() || result.clarifying_question.length > 200)) {
    throw pipelineFailure('model_output', 'missing_clarification', 'Нет текста уточнения');
  }
  return result;
}
