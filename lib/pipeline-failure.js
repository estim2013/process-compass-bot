export class PipelineFailure extends Error {
  constructor(stage, code, message, options = {}) {
    super(message, options);
    this.name = 'PipelineFailure';
    this.stage = stage;
    this.code = code;
  }
}

export function pipelineFailure(stage, code, message, options) {
  return new PipelineFailure(stage, code, message, options);
}

export function safeFailureCode(error) {
  if (error instanceof PipelineFailure) return { stage: error.stage, code: error.code };
  return { stage: 'answer_pipeline', code: 'unexpected_error' };
}

export function classifyRetryOutcome(failures, succeeded) {
  if (!failures?.length) return null;
  if (succeeded) return 'recovered';
  if (failures.length < 2) return 'not_retried';
  const first = failures[0], last = failures.at(-1);
  if (last.stage === 'model_transport') return 'failed_transport';
  return first.stage === last.stage && first.code === last.code ? 'same_failure' : 'different_failure';
}

export function classifyTransportFailure({ errorName, status } = {}) {
  if (Number.isInteger(status)) return status === 429 ? 'http_429' : status >= 500 ? 'http_5xx' : 'http_error';
  return errorName === 'TimeoutError' || errorName === 'AbortError' ? 'timeout' : 'connection_error';
}
