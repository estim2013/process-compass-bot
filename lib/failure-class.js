export function classifyRequestOutcome(outcome, refusalReason, pipelineFailures = []) {
  if (outcome === 'out_of_scope') return 'out_of_scope';
  if (outcome === 'partial_answer') return 'partial_answer';
  if (outcome === 'escalation') {
    if (refusalReason === 'NO_CANDIDATES') return 'retrieval_miss';
    if (refusalReason === 'NO_SUPPORTED_ANSWER') return 'model_no_answer';
    const lastFailure = pipelineFailures.at(-1);
    if (lastFailure?.stage && lastFailure?.code) return `${lastFailure.stage}:${lastFailure.code}`;
    if (refusalReason === 'MODEL_NOT_CONFIGURED') return 'model_not_configured';
    return 'other_escalation';
  }
  return 'answered';
}
