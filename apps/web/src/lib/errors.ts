/**
 * Application-level HTTP errors for domain/business-rule violations in the web
 * app (auth, organizations, admin). These carry a safe, developer-authored
 * message that IS meant for the client — distinct from `GatewayError`, whose
 * infra messages must never leak. `handleError` maps `AppError` → its status.
 *
 * Use for things like "not a member", "cannot remove the only owner",
 * "you cannot change your own role" — deterministic 4xx outcomes, not failures.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly data?: Record<string, unknown>;

  constructor(status: number, message: string, code = 'app_error', data?: Record<string, unknown>) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

export const isAppError = (err: unknown): err is AppError => err instanceof AppError;

export const badRequest = (message: string, data?: Record<string, unknown>) => new AppError(400, message, 'bad_request', data);
export const forbidden = (message = 'Not allowed') => new AppError(403, message, 'forbidden');
export const notFound = (message = 'Not found') => new AppError(404, message, 'not_found');
export const conflict = (message: string, data?: Record<string, unknown>) => new AppError(409, message, 'conflict', data);
