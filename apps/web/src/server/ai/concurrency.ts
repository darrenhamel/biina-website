/**
 * Per-user concurrent-generation limiter (in-memory, per-instance).
 *
 * Slots are acquired before streaming and released when the stream ends, errors,
 * or is cancelled. Per-instance by design (documented) — good enough for the
 * MVP; a distributed limiter can replace this later without call-site changes.
 */

const active = new Map<string, number>();

/** Try to acquire a slot. `max == null/undefined` means unlimited. Returns true if acquired. */
export function acquireSlot(userId: string, max: number | null | undefined): boolean {
  if (max == null) {
    active.set(userId, (active.get(userId) ?? 0) + 1);
    return true;
  }
  const current = active.get(userId) ?? 0;
  if (current >= max) return false;
  active.set(userId, current + 1);
  return true;
}

export function releaseSlot(userId: string): void {
  const current = active.get(userId) ?? 0;
  if (current <= 1) active.delete(userId);
  else active.set(userId, current - 1);
}

export function activeCount(userId: string): number {
  return active.get(userId) ?? 0;
}
