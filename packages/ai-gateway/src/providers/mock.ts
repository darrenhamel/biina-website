import type {
  AIProvider,
  ChatChunk,
  ChatRequest,
  ProviderHealth,
} from '../types';

/**
 * MockProvider — the Phase 1 development stand-in for a real model.
 *
 * It produces a deterministic, clearly-labelled BIINA response and streams it
 * word by word so the end-to-end streaming UI can be built and tested before
 * Ollama / vLLM exist. This is the ONLY place the mock lives; Phase 2 registers
 * real providers alongside it and the app code does not change.
 */
export class MockProvider implements AIProvider {
  readonly name = 'mock' as const;

  async *chat(req: ChatRequest): AsyncIterable<ChatChunk> {
    const lastUser = [...req.messages].reverse().find((m) => m.role === 'user');
    const prompt = (lastUser?.content ?? '').trim();

    const reply = buildMockReply(prompt);
    const words = reply.split(/(\s+)/); // keep whitespace tokens for natural streaming

    let output = '';
    for (const word of words) {
      if (req.signal?.aborted) break;
      output += word;
      yield { delta: word, done: false };
      // Small delay to mimic token streaming; skipped in tests via a 0 env.
      await sleep(streamDelayMs());
    }

    yield {
      delta: '',
      done: true,
      usage: estimateUsage(req.messages.map((m) => m.content).join(' '), output),
    };
  }

  async health(): Promise<ProviderHealth> {
    return { provider: this.name, ok: true, detail: 'mock provider always available' };
  }
}

function buildMockReply(prompt: string): string {
  if (!prompt) {
    return 'Hello — I am BIINA. Ask me anything to get started. (This is a development response from the mock provider; real AI arrives in Phase 2.)';
  }
  return (
    `You said: “${prompt}”.\n\n` +
    'This is a development response from BIINA’s mock AI provider. It confirms the ' +
    'full path is working: browser → BIINA server → AI gateway → provider. In Phase 2 ' +
    'this exact endpoint will stream from a real model (Ollama locally, an OpenAI-compatible ' +
    'endpoint in production) with no change to the interface you are using now.'
  );
}

/** Rough, provider-agnostic token estimate (~4 chars/token) for the mock only. */
function estimateUsage(input: string, output: string) {
  const inputTokens = Math.max(1, Math.round(input.length / 4));
  const outputTokens = Math.max(1, Math.round(output.length / 4));
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
}

function streamDelayMs(): number {
  const raw = typeof process !== 'undefined' ? process.env.MOCK_STREAM_DELAY_MS : undefined;
  const n = raw ? Number(raw) : 12;
  return Number.isFinite(n) ? n : 12;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
