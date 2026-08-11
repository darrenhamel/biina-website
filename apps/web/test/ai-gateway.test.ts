import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
  getProvider,
  getProviderForModel,
  listModels,
  resolveModel,
  streamChat,
  isGatewayError,
  OllamaProvider,
  OpenAICompatibleProvider,
  __resetProviderCache,
} from '@biina/ai-gateway';

beforeAll(() => {
  process.env.MOCK_STREAM_DELAY_MS = '0';
  process.env.AI_DEFAULT_PROVIDER = 'mock';
  delete process.env.AI_DEFAULT_MODEL;
});

afterEach(() => {
  __resetProviderCache();
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
  it('exposes mock and ollama models and resolves the default', () => {
    const ids = listModels().map((m) => m.id);
    expect(ids).toContain('biina-dev'); // mock
    expect(ids).toContain('biina-local'); // ollama
    expect(resolveModel().id).toBe('biina-dev'); // default provider = mock
  });

  it('advertises capabilities per model', () => {
    const local = listModels().find((m) => m.id === 'biina-local')!;
    expect(local.provider).toBe('ollama');
    expect(local.capabilities).toEqual({ chat: true, streaming: true });
  });

  it('reads the Ollama vendor model from OLLAMA_MODEL', () => {
    process.env.OLLAMA_MODEL = 'qwen2.5:1.5b';
    const local = listModels().find((m) => m.id === 'biina-local')!;
    expect(local.providerModel).toBe('qwen2.5:1.5b');
    delete process.env.OLLAMA_MODEL;
  });

  it('resolves the ollama provider for the local model', () => {
    const { provider, model } = getProviderForModel('biina-local');
    expect(provider.name).toBe('ollama');
    expect(provider).toBeInstanceOf(OllamaProvider);
    expect(model.provider).toBe('ollama');
  });
});

describe('openai-compatible registry entry', () => {
  afterEach(() => {
    delete process.env.OPENAI_COMPATIBLE_BASE_URL;
    delete process.env.OPENAI_COMPATIBLE_MODEL;
    delete process.env.AI_DEFAULT_PROVIDER;
    process.env.AI_DEFAULT_PROVIDER = 'mock';
    __resetProviderCache();
  });

  it('is disabled until a base URL + model are configured', () => {
    delete process.env.OPENAI_COMPATIBLE_BASE_URL;
    delete process.env.OPENAI_COMPATIBLE_MODEL;
    const entry = listModels().find((m) => m.id === 'biina-general')!;
    expect(entry.provider).toBe('openai-compatible');
    expect(entry.enabled).toBe(false);
    expect(entry.label).toBe('BIINA'); // customer-facing, no infra name
  });

  it('is enabled and hides the infra model behind providerModel once configured', () => {
    process.env.OPENAI_COMPATIBLE_BASE_URL = 'https://infer.example.com';
    process.env.OPENAI_COMPATIBLE_MODEL = 'Qwen/Qwen2.5-7B-Instruct';
    const entry = listModels().find((m) => m.id === 'biina-general')!;
    expect(entry.enabled).toBe(true);
    expect(entry.providerModel).toBe('Qwen/Qwen2.5-7B-Instruct');
    expect(entry.label).not.toContain('Qwen'); // never expose infra model in the display name
  });

  it('fails clearly when the default provider has no enabled model', () => {
    process.env.AI_DEFAULT_PROVIDER = 'openai-compatible';
    delete process.env.OPENAI_COMPATIBLE_BASE_URL; // not configured -> entry disabled
    delete process.env.OPENAI_COMPATIBLE_MODEL;
    __resetProviderCache();
    try {
      resolveModel();
      throw new Error('should have thrown');
    } catch (err) {
      expect(isGatewayError(err)).toBe(true);
      if (isGatewayError(err)) expect(err.code).toBe('invalid_config');
    }
  });
});

describe('provider router', () => {
  it('returns the right provider instance by name', () => {
    expect(getProvider('mock').name).toBe('mock');
    expect(getProvider('ollama')).toBeInstanceOf(OllamaProvider);
    expect(getProvider('openai-compatible')).toBeInstanceOf(OpenAICompatibleProvider);
  });

  it('throws a clear GatewayError for an unknown provider', () => {
    try {
      getProvider('nope-vendor');
      throw new Error('should have thrown');
    } catch (err) {
      expect(isGatewayError(err)).toBe(true);
      if (isGatewayError(err)) expect(err.code).toBe('invalid_config');
    }
  });

  it('openai-compatible is a Phase-3 stub that fails clearly (no silent paid fallback)', async () => {
    const provider = getProvider('openai-compatible');
    await expect(async () => {
      for await (const _ of provider.chat({ model: 'x', messages: [], requestId: 'r' })) void _;
    }).rejects.toMatchObject({ code: 'invalid_config' });
  });
});

describe('mock provider streaming (provider-agnostic contract)', () => {
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
    expect(text.length).toBeLessThan(50);
  });
});

describe('provider health', () => {
  it('mock provider is healthy and can enumerate models', async () => {
    const { provider } = getProviderForModel();
    const health = await provider.health();
    expect(health.ok).toBe(true);
    expect(health.provider).toBe('mock');
    expect(await provider.discoverModels?.()).toContain('biina-dev');
  });
});
