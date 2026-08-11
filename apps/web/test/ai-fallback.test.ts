import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { __resetProviderCache } from '@biina/ai-gateway';
import { startAssistantReply } from '@/server/ai/service';

/**
 * Fallback is opt-in and must NEVER be silent. These tests drive the primary
 * (openai-compatible) to fail before any token, with fetch mocked, and assert
 * the service falls back only when explicitly enabled + configured for a
 * DIFFERENT provider.
 */

const OAI_ENV = {
  AI_DEFAULT_PROVIDER: 'openai-compatible',
  OPENAI_COMPATIBLE_BASE_URL: 'https://infer.example.com',
  OPENAI_COMPATIBLE_MODEL: 'Qwen/Qwen2.5-7B-Instruct',
  OPENAI_COMPATIBLE_MAX_RETRIES: '0',
};

beforeEach(() => {
  process.env.MOCK_STREAM_DELAY_MS = '0';
  Object.assign(process.env, OAI_ENV);
  // Primary (openai-compatible) always fails to connect.
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
  __resetProviderCache();
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const k of [
    ...Object.keys(OAI_ENV),
    'AI_FALLBACK_ENABLED',
    'AI_FALLBACK_PROVIDER',
    'AI_FALLBACK_MODEL',
  ]) {
    delete process.env[k];
  }
  __resetProviderCache();
});

async function collect(stream: AsyncIterable<{ delta: string }>) {
  let text = '';
  for await (const c of stream) text += c.delta;
  return text;
}

describe('provider fallback (opt-in, never silent)', () => {
  it('falls back to the configured provider when the primary fails before streaming', async () => {
    process.env.AI_FALLBACK_ENABLED = 'true';
    process.env.AI_FALLBACK_MODEL = 'biina-dev'; // mock provider (different from primary)
    __resetProviderCache();

    const res = startAssistantReply({ messages: [{ role: 'user', content: 'hello' }] });
    const text = await collect(res.stream);

    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain('development response'); // came from the mock provider
    expect(res.meta.provider).toBe('mock'); // effective provider updated
  });

  it('does NOT fall back when fallback is disabled (error surfaces)', async () => {
    // AI_FALLBACK_ENABLED unset.
    const res = startAssistantReply({ messages: [{ role: 'user', content: 'hello' }] });
    await expect(collect(res.stream)).rejects.toMatchObject({ code: 'provider_unavailable' });
  });

  it('does NOT fall back to the SAME provider (no loop)', async () => {
    process.env.AI_FALLBACK_ENABLED = 'true';
    process.env.AI_FALLBACK_MODEL = 'biina-general'; // same openai-compatible provider
    __resetProviderCache();

    const res = startAssistantReply({ messages: [{ role: 'user', content: 'hello' }] });
    await expect(collect(res.stream)).rejects.toMatchObject({ code: 'provider_unavailable' });
  });
});
