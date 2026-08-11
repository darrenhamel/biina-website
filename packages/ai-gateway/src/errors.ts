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
  | 'unknown';

export class GatewayError extends Error {
  readonly code: GatewayErrorCode;
  readonly provider?: string;

  constructor(code: GatewayErrorCode, message: string, provider?: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'GatewayError';
    this.code = code;
    this.provider = provider;
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
        return 503;
      case 'cancelled':
        return 499; // client closed request (nginx convention)
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
