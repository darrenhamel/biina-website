import { describe, it, expect, vi, afterEach } from 'vitest';
import { OllamaProvider, isGatewayError, type ChatChunk } from '@biina/ai-gateway';

/**
 * Ollama provider tests. `fetch` is fully mocked, so these run in CI without
 * Ollama installed. They verify NDJSON streaming, usage normalization, and error
 * mapping to the provider-agnostic contract.
 */

const provider = new OllamaProvider({ baseUrl: 'http://localhost:11434', timeoutMs: 5000 });

/** Build a streaming Response body from NDJSON lines (objects or raw strings). */
function ndjson(lines: Array<Record<string, unknown> | string>, status = 200): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const l of lines) {
        const text = typeof l === 'string' ? l : JSON.stringify(l);
        controller.enqueue(enc.encode(text + '\n'));
      }
      controller.close();
    },
  });
  return new Response(body, { status });
}

async function collect(stream: AsyncIterable<ChatChunk>) {
  const deltas: string[] = [];
  let usage: ChatChunk['usage'];
  let done = false;
  for await (const c of stream) {
    if (c.delta) deltas.push(c.delta);
    if (c.usage) usage = c.usage;
    if (c.done) done = true;
  }
  return { text: deltas.join(''), usage, done };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OllamaProvider streaming', () => {
  it('normalizes NDJSON content lines into deltas and a done chunk', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      ndjson([
        { message: { role: 'assistant', content: 'BIINA ' }, done: false },
        { message: { role: 'assistant', content: 'operational' }, done: false },
        { done: true, prompt_eval_count: 12, eval_count: 5, total_duration: 2_000_000 },
      ]),
    );

    const { text, usage, done } = await collect(
      provider.chat({ model: 'llama3.2:3b', messages: [{ role: 'user', content: 'hi' }], requestId: 'r1' }),
    );

    expect(text).toBe('BIINA operational');
    expect(done).toBe(true);
    expect(usage).toEqual({ inputTokens: 12, outputTokens: 5, totalTokens: 17, generationMs: 2 });
  });

  it('sends stream:true and the vendor model to /api/chat', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(ndjson([{ message: { role: 'assistant', content: 'ok' }, done: true }]));

    await collect(provider.chat({ model: 'qwen2.5:1.5b', messages: [{ role: 'user', content: 'x' }], requestId: 'r2' }));

    const [url, init] = spy.mock.calls[0];
    expect(String(url)).toBe('http://localhost:11434/api/chat');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe('qwen2.5:1.5b');
    expect(body.stream).toBe(true);
  });

  it('maps a connection failure to provider_unavailable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    await expect(collect(provider.chat({ model: 'm', messages: [], requestId: 'r3' }))).rejects.toMatchObject({
      code: 'provider_unavailable',
    });
  });

  it('maps HTTP 404 to model_unavailable', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 404 }));
    await expect(collect(provider.chat({ model: 'missing', messages: [], requestId: 'r4' }))).rejects.toMatchObject({
      code: 'model_unavailable',
    });
  });

  it('maps an in-stream "model not found" error line to model_unavailable', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(ndjson([{ error: 'model "x" not found, try pulling it' }]));
    await expect(collect(provider.chat({ model: 'x', messages: [], requestId: 'r5' }))).rejects.toMatchObject({
      code: 'model_unavailable',
    });
  });

  it('maps a malformed JSON line to bad_response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(ndjson(['this is not json']));
    await expect(collect(provider.chat({ model: 'm', messages: [], requestId: 'r6' }))).rejects.toMatchObject({
      code: 'bad_response',
    });
  });

  it('does not make a request when the signal is already aborted (clean stop)', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const controller = new AbortController();
    controller.abort();
    const { text, done } = await collect(
      provider.chat({ model: 'm', messages: [], requestId: 'r7', signal: controller.signal }),
    );
    expect(text).toBe('');
    expect(done).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('health() reports reachable when /api/tags is OK', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ models: [{ name: 'llama3.2:3b' }] }), { status: 200 }),
    );
    const health = await provider.health();
    expect(health.ok).toBe(true);
    expect(health.provider).toBe('ollama');
  });

  it('discoverModels() lists installed tags', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ models: [{ name: 'llama3.2:3b' }, { name: 'qwen2.5:1.5b' }] }), { status: 200 }),
    );
    const models = await provider.discoverModels();
    expect(models).toEqual(['llama3.2:3b', 'qwen2.5:1.5b']);
  });

  it('surfaces GatewayError instances (isGatewayError)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('down'));
    try {
      await collect(provider.chat({ model: 'm', messages: [], requestId: 'r8' }));
      throw new Error('should have thrown');
    } catch (err) {
      expect(isGatewayError(err)).toBe(true);
    }
  });
});
