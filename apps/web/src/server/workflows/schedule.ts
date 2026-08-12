import { z } from 'zod';

/**
 * Timezone-aware scheduling WITHOUT a heavy dependency. DST is never hand-computed:
 * we read each zone's ACTUAL offset at a given instant from the platform Intl/ICU
 * timezone database, then solve for the UTC instant whose wall-clock in the target
 * zone matches the desired local time. IANA identifiers only (e.g. "Asia/Dubai").
 */

export const scheduleSchema = z
  .object({
    pattern: z.enum(['once', 'daily', 'weekly', 'monthly', 'cron']),
    // Local wall-clock "HH:MM" (24h) for daily/weekly/monthly.
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
    // 0=Sun … 6=Sat for weekly.
    weekday: z.number().int().min(0).max(6).optional(),
    // 1..31 for monthly (clamped to the month's last day).
    day: z.number().int().min(1).max(31).optional(),
    // ISO instant for a one-time run.
    at: z.string().datetime().optional(),
    // Advanced/admin only — a restricted 5-field cron (validated elsewhere).
    cron: z.string().max(120).optional(),
  })
  .strict();

export type Schedule = z.infer<typeof scheduleSchema>;

/** Validate an IANA timezone id against the platform tz database. */
export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The offset (minutes) that `tz` is ahead of UTC at the given UTC instant. */
function zoneOffsetMinutes(utc: Date, tz: string): number {
  // Format the UTC instant AS wall-clock in `tz`, then diff against the same
  // fields interpreted as UTC — that difference is the zone's offset at that time.
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = Object.fromEntries(dtf.formatToParts(utc).filter((x) => x.type !== 'literal').map((x) => [x.type, x.value]));
  const asUTC = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour === '24' ? '0' : p.hour), Number(p.minute), Number(p.second));
  return Math.round((asUTC - utc.getTime()) / 60_000);
}

/** Convert a wall-clock time in `tz` to the corresponding UTC instant (DST-correct). */
export function zonedWallClockToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string): Date {
  // First guess: treat the wall clock as if it were UTC, then correct by the
  // zone offset at that guess (a second pass handles the offset-changed edge).
  const guess = Date.UTC(y, mo - 1, d, h, mi, 0);
  let offset = zoneOffsetMinutes(new Date(guess), tz);
  let utc = guess - offset * 60_000;
  const offset2 = zoneOffsetMinutes(new Date(utc), tz);
  if (offset2 !== offset) {
    offset = offset2;
    utc = guess - offset * 60_000;
  }
  return new Date(utc);
}

/** Wall-clock parts of a UTC instant in a given zone. */
function partsInZone(utc: Date, tz: string): { y: number; mo: number; d: number; h: number; mi: number; weekday: number } {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const p = Object.fromEntries(dtf.formatToParts(utc).filter((x) => x.type !== 'literal').map((x) => [x.type, x.value]));
  const wdMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { y: Number(p.year), mo: Number(p.month), d: Number(p.day), h: Number(p.hour === '24' ? '0' : p.hour), mi: Number(p.minute), weekday: wdMap[p.weekday as string] ?? 0 };
}

function daysInMonth(y: number, mo: number): number {
  return new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

/**
 * Compute the next run instant strictly AFTER `after`, for a schedule in `tz`.
 * Returns null for a one-time schedule already in the past. DST-correct via
 * zonedWallClockToUtc. Monthly clamps day 31 to the month's last day.
 */
export function computeNextRun(schedule: Schedule, tz: string, after: Date = new Date()): Date | null {
  if (schedule.pattern === 'once') {
    if (!schedule.at) return null;
    const at = new Date(schedule.at);
    return at.getTime() > after.getTime() ? at : null;
  }

  const [hh, mm] = (schedule.time ?? '09:00').split(':').map(Number);
  const now = partsInZone(after, tz);

  // Try each candidate day forward until we find a wall-clock instant after `after`.
  for (let addDays = 0; addDays <= 366; addDays++) {
    // Build the candidate local date by walking forward from today's zone date.
    const base = new Date(Date.UTC(now.y, now.mo - 1, now.d + addDays, 12, 0, 0)); // noon avoids DST gaps
    const cd = partsInZone(base, tz);

    if (schedule.pattern === 'weekly' && schedule.weekday != null && cd.weekday !== schedule.weekday) continue;
    if (schedule.pattern === 'monthly' && schedule.day != null) {
      const targetDay = Math.min(schedule.day, daysInMonth(cd.y, cd.mo));
      if (cd.d !== targetDay) continue;
    }

    const candidate = zonedWallClockToUtc(cd.y, cd.mo, cd.d, hh, mm, tz);
    if (candidate.getTime() > after.getTime()) return candidate;
  }
  return null;
}

/** Stable run key for a scheduled instant (duplicate-run prevention). */
export function scheduledRunKey(scheduledFor: Date): string {
  return `sched:${scheduledFor.toISOString()}`;
}
