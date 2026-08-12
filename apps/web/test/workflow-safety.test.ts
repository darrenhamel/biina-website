import { describe, it, expect } from 'vitest';
import { computeNextRun, zonedWallClockToUtc, isValidTimezone, scheduledRunKey, type Schedule } from '@/server/workflows/schedule';
import { actionDestinations } from '@/server/workflows/standing-auth';
import { validateWorkflowConfig, draftFromNaturalLanguage } from '@/server/workflows/compiler';
import { getAgentTool } from '@/server/agent/tool-catalog';
import type { CreateWorkflowInput } from '@/lib/validation';

describe('timezone-aware scheduling (DST-correct via Intl)', () => {
  it('converts a wall-clock time to the correct UTC instant per zone', () => {
    // Dubai is a fixed UTC+4 (no DST): 08:00 local → 04:00 UTC.
    expect(zonedWallClockToUtc(2026, 1, 15, 8, 0, 'Asia/Dubai').getUTCHours()).toBe(4);
    // New York in January is EST (UTC-5): 08:00 → 13:00 UTC.
    expect(zonedWallClockToUtc(2026, 1, 15, 8, 0, 'America/New_York').getUTCHours()).toBe(13);
    // New York in July is EDT (UTC-4): 08:00 → 12:00 UTC. DST handled without manual offsets.
    expect(zonedWallClockToUtc(2026, 7, 15, 8, 0, 'America/New_York').getUTCHours()).toBe(12);
  });

  it('computes the next daily run strictly in the future, at the right wall-clock', () => {
    const after = new Date('2026-01-15T00:00:00Z');
    const next = computeNextRun({ pattern: 'daily', time: '08:00' }, 'Asia/Dubai', after)!;
    expect(next.toISOString()).toBe('2026-01-15T04:00:00.000Z'); // 08:00 Dubai
    expect(next.getTime()).toBeGreaterThan(after.getTime());
  });

  it('rolls to the next day when today\'s time already passed', () => {
    const after = new Date('2026-01-15T06:00:00Z'); // 10:00 Dubai, past 08:00
    const next = computeNextRun({ pattern: 'daily', time: '08:00' }, 'Asia/Dubai', after)!;
    expect(next.toISOString()).toBe('2026-01-16T04:00:00.000Z');
  });

  it('handles weekly + monthly (day-31 clamps to the month end)', () => {
    const after = new Date('2026-02-01T00:00:00Z');
    const weekly = computeNextRun({ pattern: 'weekly', time: '09:00', weekday: 1 }, 'UTC', after)!;
    expect(weekly.getUTCDay()).toBe(1); // Monday
    const monthly = computeNextRun({ pattern: 'monthly', time: '09:00', day: 31 }, 'UTC', after)!;
    expect(monthly.getUTCMonth()).toBe(1); // February
    expect(monthly.getUTCDate()).toBe(28); // clamped (2026 is not a leap year)
  });

  it('a past one-time schedule yields no next run', () => {
    expect(computeNextRun({ pattern: 'once', at: '2000-01-01T00:00:00Z' }, 'UTC', new Date())).toBeNull();
  });

  it('validates IANA timezones and makes stable run keys', () => {
    expect(isValidTimezone('Asia/Dubai')).toBe(true);
    expect(isValidTimezone('Not/AZone')).toBe(false);
    const d = new Date('2026-01-15T04:00:00Z');
    expect(scheduledRunKey(d)).toBe(scheduledRunKey(d));
    expect(scheduledRunKey(d)).not.toBe(scheduledRunKey(new Date('2026-01-16T04:00:00Z')));
  });
});

describe('standing-authorization destination binding', () => {
  it('extracts and lowercases email recipients (to + cc)', () => {
    const send = getAgentTool('gmail.send')!;
    expect(actionDestinations(send, { to: ['Ops@Supplier.com'], cc: ['Mgr@Co.com'] }).sort()).toEqual(['mgr@co.com', 'ops@supplier.com']);
  });
  it('extracts a slack channel', () => {
    const post = getAgentTool('slack.post')!;
    expect(actionDestinations(post, { channel: '#ops' })).toEqual(['#ops']);
  });
});

describe('workflow validation', () => {
  const base: CreateWorkflowInput = {
    name: 'Test', goal: 'Do a thing', ownerType: 'PERSONAL', agentMode: 'AGENT', approvalPolicy: 'READ_ONLY_AUTOMATIC', timezone: 'Asia/Dubai',
    trigger: { type: 'SCHEDULE', schedule: { pattern: 'daily', time: '08:00' } },
  };

  it('accepts a valid daily schedule', () => {
    expect(validateWorkflowConfig(base)).toHaveLength(0);
  });
  it('rejects an unknown timezone', () => {
    const issues = validateWorkflowConfig({ ...base, timezone: 'Mars/Base' });
    expect(issues.some((i) => i.field === 'timezone')).toBe(true);
  });
  it('rejects a weekly schedule with no weekday and a too-frequent condition', () => {
    expect(validateWorkflowConfig({ ...base, trigger: { type: 'SCHEDULE', schedule: { pattern: 'weekly', time: '08:00' } } }).some((i) => i.field.includes('weekday'))).toBe(true);
    expect(validateWorkflowConfig({ ...base, trigger: { type: 'CONDITION', checkIntervalMinutes: 1 } }).some((i) => i.field.includes('checkInterval'))).toBe(true);
  });
});

describe('natural-language workflow compiler (deterministic draft)', () => {
  it('drafts a daily read-only briefing from "every morning summarize emails"', () => {
    const d = draftFromNaturalLanguage('Every weekday morning summarize important unread emails', 'Asia/Dubai');
    expect(d.trigger.type).toBe('SCHEDULE');
    expect(d.trigger.schedule?.pattern).toBe('daily');
    expect(d.approvalPolicy).toBe('READ_ONLY_AUTOMATIC'); // no send → automatic reads
    expect(d.maxWritesPerRun).toBe(0);
  });
  it('drafts an ASK_EVERY_WRITE workflow when sending is implied', () => {
    const d = draftFromNaturalLanguage('Every Friday email the weekly report to management', 'UTC');
    expect(d.trigger.schedule?.pattern).toBe('weekly');
    expect(d.approvalPolicy).toBe('ASK_EVERY_WRITE'); // implies an external send
    expect(d.maxWritesPerRun).toBe(1);
  });
  it('drafts a condition workflow from "check daily / flag"', () => {
    const d = draftFromNaturalLanguage('Check my CRM daily and flag stale opportunities', 'UTC');
    // "daily" wins as a schedule; either way it must not silently send.
    expect(['SCHEDULE', 'CONDITION']).toContain(d.trigger.type);
    expect(d.maxWritesPerRun).toBe(0);
  });
});
