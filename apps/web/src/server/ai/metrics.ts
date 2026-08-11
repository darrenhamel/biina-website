/**
 * Minimal in-memory AI metrics for ADMIN visibility.
 *
 * Process-local counters (reset on restart, per-instance in multi-instance
 * deploys) — NOT durable analytics. Persistent, per-user usage metering lands in
 * Phase 4. Kept deliberately small (section 29: no dashboard yet).
 */

interface Counters {
  requests: number;
  success: number;
  errors: number;
  cancelled: number;
  failovers: number;
  totalLatencyMs: number;
  totalTtftMs: number;
  ttftSamples: number;
  lastErrorCode?: string;
  lastAt?: string;
}

const c: Counters = {
  requests: 0,
  success: 0,
  errors: 0,
  cancelled: 0,
  failovers: 0,
  totalLatencyMs: 0,
  totalTtftMs: 0,
  ttftSamples: 0,
};

export function recordRequest(): void {
  c.requests += 1;
}

export function recordResult(input: {
  status: 'success' | 'error' | 'cancelled' | 'failover_success';
  latencyMs: number;
  ttftMs?: number;
  errorCode?: string;
  isoTime: string;
}): void {
  c.totalLatencyMs += input.latencyMs;
  if (input.ttftMs !== undefined) {
    c.totalTtftMs += input.ttftMs;
    c.ttftSamples += 1;
  }
  c.lastAt = input.isoTime;
  if (input.status === 'error') {
    c.errors += 1;
    c.lastErrorCode = input.errorCode;
  } else if (input.status === 'cancelled') {
    c.cancelled += 1;
  } else {
    c.success += 1;
    if (input.status === 'failover_success') c.failovers += 1;
  }
}

export function metricsSnapshot() {
  const completed = c.success + c.errors + c.cancelled;
  return {
    requests: c.requests,
    success: c.success,
    errors: c.errors,
    cancelled: c.cancelled,
    failovers: c.failovers,
    avgLatencyMs: completed ? Math.round(c.totalLatencyMs / completed) : 0,
    avgTtftMs: c.ttftSamples ? Math.round(c.totalTtftMs / c.ttftSamples) : 0,
    lastErrorCode: c.lastErrorCode,
    lastAt: c.lastAt,
    note: 'in-memory, per-instance; resets on restart',
  };
}
