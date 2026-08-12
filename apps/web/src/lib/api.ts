import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { isGatewayError } from '@biina/ai-gateway';
import { isAppError } from './errors';
import { logger } from './logger';

/**
 * API response helpers. Internal errors are logged server-side but NEVER leaked
 * to the client — users get a generic message and, for validation, field info.
 */

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function badRequest(message: string, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status: 400 });
}

export function unauthorized(message = 'Authentication required') {
  return NextResponse.json({ error: message }, { status: 401 });
}

export function forbidden(message = 'Not allowed') {
  return NextResponse.json({ error: message }, { status: 403 });
}

export function notFound(message = 'Not found') {
  return NextResponse.json({ error: message }, { status: 404 });
}

/** Turn any thrown error into a safe response. Zod → 400 with field details. */
export function handleError(err: unknown, context: string) {
  if (err instanceof ZodError) {
    return NextResponse.json(
      { error: 'Invalid request', details: err.flatten().fieldErrors },
      { status: 400 },
    );
  }
  // Domain/business-rule errors: safe, specific message meant for the client.
  if (isAppError(err)) {
    return NextResponse.json(
      { error: err.message, code: err.code, ...(err.data ? { data: err.data } : {}) },
      { status: err.status },
    );
  }
  // Gateway errors: surface only the SAFE generic message + code, never internals.
  if (isGatewayError(err)) {
    if (err.httpStatus() >= 500) logger.error('api.gateway', { context, code: err.code, error: err.message });
    return NextResponse.json(
      { error: err.userMessage(), code: err.code, ...(err.data ? { data: err.data } : {}) },
      { status: err.httpStatus() },
    );
  }
  logger.error('api.unhandled', { context, error: String(err) });
  return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 });
}
