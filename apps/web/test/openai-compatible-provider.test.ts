import { describe, it, expect, vi, afterEach } from 'vitest';
import { OpenAICompatibleProvider, isGatewayError, type ChatChunk } from '@biina/ai-gateway';

/**
 * OpenAI-compatible provider tests. `fetch` is fully mocked (no RunPod/vLLM
 * needed). Verifies SSE streaming, usage normalization, auth, endpoint building,
 * cancellation, timeout, and error mapping to the provider-agnostic contract.
 */

function makeProvider(opts?: Partial<ConstructorParameters<typeof OpenAICompatibleProvider>[0]>) {
  return new OpenAICompatibleProvider({
    baseUrl: 'https://infer.example.com',
    apiKey: 'secret-key',
    timeoutMs: 5000,
    maxConnectRetries: 0,
    ...opts,
  });
}

/** Build an SSE Response body from OpenAI-style events (objects or '[DONE]'). */
function sse(events: Array<Record<string, unknown> | string>, status = 200): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const e of events) {
        const payload = typeof e === 'string' ? e : JSON.stringify(e);
        controller.enqueue(enc.encode(`data: ${payload}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(body, { status, headers: { 'content-type': 'text/event-stream' } });
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

const req = (extra?: Record<string, unknown>) => ({
  model: 'Qwen/Qwen2.5-7B-Instruct',
  messages: [{ role: 'user' as const, content: 'hi' }],
  requestId: 'r-oai',
  ...extra,
});

afterEach(() => vi.restoreAllMocks());

describe('OpenAICompatibleProvider streaming', () => {
  it('normalizes SSE delta events + usage + [DONE]', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      sse([
        { choices: [{ delta: { role: 'assistant', content: 'BIINA ' } }] },
        { choices: [{ delta: { content: 'cloud ' } }] },
        { choices: [{ delta: { content: 'operational' } }] },
        { choices: [{ delta: {}, finish_reason: 'stop' }] },
        { choices: [], usage: { prompt_tokens: 20, completion_tokens: 6, total_tokens: 26 } },
        '[DONE]',
      ]),
    );
    const { text, usage, done } = await collect(makeProvider().chat(req()));
    expect(text).toBe('BIINA cloud operational');
    expect(done).toBe(true);
    expect(usage).toEqual({ inputTokens: 20, outputTokens: 6, totalTokens: 26 });
  });

  it('emits a terminal done chunk even if the server closes without [DONE]', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      sse([{ choices: [{ delta: { content: 'partial-final' } }] }]),
    );
    const { text, done } = await collect(makeProvider().chat(req()));
    expect(text).toBe('partial-final');
    expect(done).toBe(true);
  });

  it('sends stream:true + the vendor model and hits /v1/chat/completions', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(sse(['[DONE]']));
    await collect(makeProvider().chat(req()));
    const [url, init] = spy.mock.calls[0];
    expect(String(url)).toBe('https://infer.example.com/v1/chat/completions');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe('Qwen/Qwen2.5-7B-Instruct');
    expect(body.stream).toBe(true);
  });

  it('does not double /v1 when the base URL already ends in /v1', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(sse(['[DONE]']));
    await collect(makeProvider({ baseUrl: 'https://api.runpod.ai/v2/abc/openai/v1' }).chat(req()));
    expect(String(spy.mock.calls[0][0])).toBe(
      'https://api.runpod.ai/v2/abc/openai/v1/chat/completions',
    );
  });
});

describe('OpenAICompatibleProvider auth', () => {
  it('sends a Bearer header when an API key is configured', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(sse(['[DONE]']));
    await collect(makeProvider({ apiKey: 'secret-key' }).chat(req()));
    const headers = (spy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer secret-key');
  });

  it('omits the Authorization header for unauthenticated endpoints', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(sse(['[DONE]']));
    await collect(makeProvider({ apiKey: undefined }).chat(req()));
    const headers = (spy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });
});

describe('OpenAICompatibleProvider error mapping', () => {
  it('unreachable endpoint -> provider_unavailable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    await expect(collect(makeProvider().chat(req()))).rejects.toMatchObject({ code: 'provider_unavailable' });
  });

  it('401 -> invalid_config (auth failure)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('unauthorized', { status: 401 }));
    await expect(collect(makeProvider().chat(req()))).rejects.toMatchObject({ code: 'invalid_config' });
  });

  it('400 mentioning model -> model_unavailable', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'model "x" does not exist' } }), { status: 400 }),
    );
    await expect(collect(makeProvider().chat(req()))).rejects.toMatchObject({ code: 'model_unavailable' });
  });

  it('429 -> provider_unavailable (rate limited / overloaded)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('slow down', { status: 429 }));
    await expect(collect(makeProvider().chat(req()))).rejects.toMatchObject({ code: 'provider_unavailable' });
  });

  it('503 -> provider_unavailable (GPU worker unavailable / cold start)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('unavailable', { status: 503 }));
    await expect(collect(makeProvider().chat(req()))).rejects.toMatchObject({ code: 'provider_unavailable' });
  });

  it('malformed SSE JSON -> bad_response', async () => {
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode('data: {not valid json\n\n'));
        c.close();
      },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status: 200 }));
    await expect(collect(makeProvider().chat(req()))).rejects.toMatchObject({ code: 'bad_response' });
  });

  it('in-stream error event -> mapped GatewayError', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(sse([{ error: { message: 'internal failure' } }]));
    try {
      await collect(makeProvider().chat(req()));
      throw new Error('should have thrown');
    } catch (err) {
      expect(isGatewayError(err)).toBe(true);
    }
  });

  it('interrupted stream (reader error) rejects', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"x"}}]}\n\n'));
        c.error(new Error('connection reset'));
      },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status: 200 }));
    await expect(collect(makeProvider().chat(req()))).rejects.toBeTruthy();
  });
});

describe('OpenAICompatibleProvider timeout & cancellation', () => {
  it('aborts and maps to timeout when the request exceeds timeoutMs', async () => {
    // fetch that only rejects when its signal aborts (simulates a hang).
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        );
      }) as Promise<Response>;
    });
    await expect(collect(makeProvider({ timeoutMs: 20 }).chat(req()))).rejects.toMatchObject({ code: 'timeout' });
  });

  it('does not call fetch when the signal is already aborted', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const controller = new AbortController();
    controller.abort();
    const { text } = await collect(makeProvider().chat(req({ signal: controller.signal })));
    expect(text).toBe('');
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('OpenAICompatibleProvider health & discovery', () => {
  it('health() hits /v1/models and reports reachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: 'Qwen/Qwen2.5-7B-Instruct' }] }), { status: 200 }),
    );
    const h = await makeProvider().health();
    expect(h.ok).toBe(true);
    expect(h.provider).toBe('openai-compatible');
  });

  it('health() reports auth failure on 401', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('no', { status: 401 }));
    const h = await makeProvider().health();
    expect(h.ok).toBe(false);
    expect(h.detail).toMatch(/auth/i);
  });

  it('discoverModels() lists model ids from /v1/models', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: 'a' }, { id: 'b' }] }), { status: 200 }),
    );
    expect(await makeProvider().discoverModels()).toEqual(['a', 'b']);
  });
});
