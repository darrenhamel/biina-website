/**
 * Gateway error taxonomy.
 *
 * Providers throw `GatewayError` with a stable `code`. The app maps the code to
 * a safe, user-facing message (see `userMessage`) while logging the technical
 * `message`/cause server-side. Internal details never reach the browser.
 */

export type GatewayErrorCode =
  | 'provider_unavailable' // cannot reach the provider (connection refused, DNS, etc.)
  | 'model_unavailable' // provider is up but the requested model is missing
  | 'timeout' // provider did not respond/finish in time
  | 'cancelled' // the caller aborted the request
  | 'invalid_config' // misconfiguration (unknown provider, missing base URL, etc.)
  | 'bad_response' // provider returned an unexpected/unparseable payload
  // Phase 5 — entitlement / metering / budget (pre-generation checks).
  | 'not_entitled' // the user's plan does not permit this model/workload/persona/feature
  | 'quota_exceeded' // daily/monthly request or token allowance reached
  | 'rate_limited' // too many requests per minute or too many concurrent generations
  | 'context_too_large' // input exceeds the plan's allowed context size
  | 'budget_exceeded' // platform hard cost limit reached
  | 'unknown';

export class GatewayError extends Error {
  readonly code: GatewayErrorCode;
  readonly provider?: string;
  /** Optional non-secret data for the client (e.g. quota resetAt / remaining). */
  readonly data?: Record<string, unknown>;

  constructor(
    code: GatewayErrorCode,
    message: string,
    provider?: string,
    options?: { cause?: unknown; data?: Record<string, unknown> },
  ) {
    super(message, options);
    this.name = 'GatewayError';
    this.code = code;
    this.provider = provider;
    this.data = options?.data;
  }

  /** Safe, generic message suitable for end users (no infra detail). */
  userMessage(): string {
    switch (this.code) {
      case 'provider_unavailable':
      case 'timeout':
        return 'The AI service is temporarily unavailable. Please try again in a moment.';
      case 'model_unavailable':
        return 'The AI model is not available right now. Please try again shortly.';
      case 'cancelled':
        return 'The request was cancelled.';
      case 'not_entitled':
        return 'Your plan does not include this. Upgrade to unlock it.';
      case 'quota_exceeded':
        return "You've reached your usage limit for now. It resets soon.";
      case 'rate_limited':
        return "You're sending requests too quickly or have too many running. Please wait a moment.";
      case 'context_too_large':
        return 'This conversation is too long for your plan. Start a new chat or shorten it.';
      case 'budget_exceeded':
        return 'The AI service is temporarily unavailable. Please try again later.';
      case 'invalid_config':
        return 'The AI service is not configured correctly.';
      case 'bad_response':
      case 'unknown':
      default:
        return 'Something went wrong while generating a response.';
    }
  }

  /** Suggested HTTP status for this error. */
  httpStatus(): number {
    switch (this.code) {
      case 'provider_unavailable':
      case 'timeout':
      case 'model_unavailable':
      case 'budget_exceeded':
        return 503;
      case 'cancelled':
        return 499; // client closed request (nginx convention)
      case 'not_entitled':
        return 403;
      case 'quota_exceeded':
      case 'rate_limited':
        return 429;
      case 'context_too_large':
        return 413;
      case 'invalid_config':
        return 500;
      default:
        return 500;
    }
  }
}

export function isGatewayError(err: unknown): err is GatewayError {
  return err instanceof GatewayError;
}

/** Normalize any thrown value into a GatewayError. */
export function toGatewayError(err: unknown, provider?: string): GatewayError {
  if (isGatewayError(err)) return err;
  const name = (err as { name?: string })?.name;
  if (name === 'AbortError') {
    return new GatewayError('cancelled', 'Request aborted', provider, { cause: err });
  }
  return new GatewayError('unknown', String((err as Error)?.message ?? err), provider, { cause: err });
}
