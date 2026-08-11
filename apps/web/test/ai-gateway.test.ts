import { describe, it, expect, beforeAll } from 'vitest';
import { getProviderForModel, listModels, resolveModel, streamChat } from '@biina/ai-gateway';

beforeAll(() => {
  process.env.MOCK_STREAM_DELAY_MS = '0';
});

async function collect(stream: AsyncIterable<{ delta: string; done: boolean }>) {
  let text = '';
  let sawDone = false;
  for await (const c of stream) {
    text += c.delta;
    if (c.done) sawDone = true;
  }
  return { text, sawDone };
}

describe('model registry', () => {
  it('exposes at least one model and resolves the default', () => {
    expect(listModels().length).toBeGreaterThan(0);
    expect(resolveModel().id).toBe('biina-dev');
  });

  it('resolves the mock provider for the default model', () => {
    const { provider, model } = getProviderForModel();
    expect(provider.name).toBe('mock');
    expect(model.provider).toBe('mock');
  });
});

describe('mock provider streaming', () => {
  it('streams a non-empty reply and terminates with done', async () => {
    const { stream } = streamChat({
      messages: [{ role: 'user', content: 'Hello BIINA' }],
      requestId: 'test-1',
    });
    const { text, sawDone } = await collect(stream);
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain('Hello BIINA');
    expect(sawDone).toBe(true);
  });

  it('reports usage metadata on completion', async () => {
    const { provider } = getProviderForModel();
    let usage: unknown;
    for await (const c of provider.chat({
      model: 'biina-dev',
      messages: [{ role: 'user', content: 'usage please' }],
      requestId: 'test-2',
    })) {
      if (c.done) usage = c.usage;
    }
    expect(usage).toMatchObject({ totalTokens: expect.any(Number) });
  });

  it('stops early when the signal is aborted', async () => {
    const controller = new AbortController();
    const { stream } = streamChat({
      messages: [{ role: 'user', content: 'long answer' }],
      requestId: 'test-3',
      signal: controller.signal,
    });
    controller.abort();
    const { text } = await collect(stream);
    // Aborted before/at first tick — should not produce the full reply.
    expect(text.length).toBeLessThan(50);
  });
});

describe('provider health', () => {
  it('mock provider is healthy', async () => {
    const { provider } = getProviderForModel();
    const health = await provider.health();
    expect(health.ok).toBe(true);
    expect(health.provider).toBe('mock');
  });
});
