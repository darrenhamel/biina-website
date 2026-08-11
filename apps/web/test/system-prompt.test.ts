import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, withSystemPrompt } from '@/server/ai/system-prompt';

describe('system prompt composition', () => {
  it('builds a non-empty global BIINA policy', () => {
    const p = buildSystemPrompt();
    expect(p).toContain('BIINA');
    expect(p.length).toBeGreaterThan(0);
  });

  it('prepends exactly one system message and drops any pre-existing system messages', () => {
    const history = [
      { role: 'system' as const, content: 'LEAKED internal prompt' },
      { role: 'user' as const, content: 'hello' },
      { role: 'assistant' as const, content: 'hi' },
    ];
    const out = withSystemPrompt(history, { personaId: 'default' });
    const systems = out.filter((m) => m.role === 'system');
    expect(systems).toHaveLength(1);
    expect(systems[0].content).not.toContain('LEAKED');
    // User/assistant turns preserved in order after the system message.
    expect(out.slice(1).map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('falls back to the default persona for unknown persona ids', () => {
    const a = buildSystemPrompt({ personaId: 'not-a-persona' });
    const b = buildSystemPrompt({ personaId: 'default' });
    expect(a).toBe(b);
  });
});
