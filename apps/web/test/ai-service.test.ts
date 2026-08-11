import { describe, it, expect, beforeAll } from 'vitest';
import { startAssistantReply } from '@/server/ai/service';
import type { ChatChunk } from '@biina/ai-gateway';

/**
 * Service-layer tests. These use the mock provider (default) and assert the
 * app only ever sees the provider-agnostic ChatChunk contract — no Ollama- or
 * vendor-specific fields — proving /api/ai/chat stays provider-agnostic.
 */

beforeAll(() => {
  process.env.MOCK_STREAM_DELAY_MS = '0';
  process.env.AI_DEFAULT_PROVIDER = 'mock';
});

async function drain(stream: AsyncIterable<ChatChunk>) {
  const chunks: ChatChunk[] = [];
  for await (const c of stream) chunks.push(c);
  return chunks;
}

describe('startAssistantReply', () => {
  it('returns a correlation id, provider, logical model, and a stream', async () => {
    const res = startAssistantReply({
      messages: [{ role: 'user', content: 'hi' }],
      conversationId: 'conv-1',
      userId: 'user-1',
    });
    expect(res.requestId).toMatch(/[0-9a-f-]{36}/);
    expect(res.provider).toBe('mock');
    expect(res.model).toBe('biina-dev'); // logical id, not a vendor name
    const chunks = await drain(res.stream);
    expect(chunks.length).toBeGreaterThan(0);
  });

  it('yields only provider-agnostic chunk fields (delta/done/usage)', async () => {
    const res = startAssistantReply({ messages: [{ role: 'user', content: 'shape check' }] });
    const chunks = await drain(res.stream);
    for (const c of chunks) {
      expect(Object.keys(c).sort()).toEqual(
        expect.arrayContaining(Object.keys(c).filter((k) => ['delta', 'done', 'usage'].includes(k))),
      );
      // No unexpected keys leaked from a provider payload.
      for (const key of Object.keys(c)) expect(['delta', 'done', 'usage']).toContain(key);
    }
    const last = chunks.at(-1)!;
    expect(last.done).toBe(true);
  });

  it('stops streaming when the caller signal aborts', async () => {
    const controller = new AbortController();
    const res = startAssistantReply({
      messages: [{ role: 'user', content: 'a long answer please' }],
      signal: controller.signal,
    });
    controller.abort();
    const chunks = await drain(res.stream);
    const text = chunks.map((c) => c.delta).join('');
    expect(text.length).toBeLessThan(50);
  });
});
