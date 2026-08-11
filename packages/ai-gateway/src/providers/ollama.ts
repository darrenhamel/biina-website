import type { AIProvider, ChatChunk, ChatRequest, ProviderHealth } from '../types';
import { GatewayError, toGatewayError } from '../errors';

/**
 * OllamaProvider — talks to a local Ollama server over its HTTP API.
 *
 * Server-side only. The BIINA app never reaches Ollama directly; it calls the
 * gateway, which calls this provider. Ollama's NDJSON stream is normalized into
 * the provider-agnostic `ChatChunk` contract, so nothing above the gateway sees
 * an Ollama-specific payload.
 *
 * Docs: https://github.com/ollama/ollama/blob/main/docs/api.md
 */

export interface OllamaProviderOptions {
  baseUrl: string;
  /** Hard timeout for a single generation request, in ms. */
  timeoutMs: number;
}

/** Shape of a streamed line from POST /api/chat (fields we use). */
interface OllamaChatLine {
  model?: string;
  message?: { role: string; content: string };
  done?: boolean;
  error?: string;
  // Metrics present on the final (done) line:
  prompt_eval_count?: number;
  eval_count?: number;
  total_duration?: number; // nanoseconds
}

export class OllamaProvider implements AIProvider {
  readonly name = 'ollama' as const;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(opts: OllamaProviderOptions) {
    // Normalize trailing slash so `${baseUrl}/api/...` is always well-formed.
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = opts.timeoutMs;
  }

  async *chat(req: ChatRequest): AsyncIterable<ChatChunk> {
    if (!this.baseUrl) {
      throw new GatewayError('invalid_config', 'OLLAMA_BASE_URL is not set', this.name);
    }
    // Already cancelled before we started — clean stop, no request made.
    if (req.signal?.aborted) return;

    // Compose the caller's signal with a hard per-request timeout.
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    req.signal?.addEventListener('abort', onAbort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: req.model,
          messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
          stream: true,
          options:
            req.temperature !== undefined ? { temperature: req.temperature } : undefined,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      req.signal?.removeEventListener('abort', onAbort);
      // A caller-initiated abort is a clean stop, not an error.
      if (req.signal?.aborted) return;
      if (timedOut) throw new GatewayError('timeout', 'Ollama request timed out', this.name, { cause: err });
      throw new GatewayError(
        'provider_unavailable',
        `Cannot reach Ollama at ${this.baseUrl}`,
        this.name,
        { cause: err },
      );
    }

    try {
      if (res.status === 404) {
        throw new GatewayError('model_unavailable', `Model "${req.model}" is not available in Ollama`, this.name);
      }
      if (!res.ok || !res.body) {
        const detail = await safeText(res);
        throw new GatewayError('bad_response', `Ollama returned ${res.status}: ${detail}`, this.name);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await reader.read();
        } catch (err) {
          if (req.signal?.aborted) return; // clean stop
          if (timedOut) throw new GatewayError('timeout', 'Ollama stream timed out', this.name, { cause: err });
          throw toGatewayError(err, this.name);
        }
        if (chunk.done) break;

        buffer += decoder.decode(chunk.value, { stream: true });
        // Ollama streams newline-delimited JSON objects.
        let nl: number;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          for (const out of this.parseLine(line)) yield out;
        }
      }

      // Flush any trailing buffered line (no final newline).
      const tail = buffer.trim();
      if (tail) {
        for (const out of this.parseLine(tail)) yield out;
      }
    } finally {
      clearTimeout(timer);
      req.signal?.removeEventListener('abort', onAbort);
    }
  }

  /** Parse one NDJSON line into zero or more normalized chunks. */
  private *parseLine(line: string): Iterable<ChatChunk> {
    let parsed: OllamaChatLine;
    try {
      parsed = JSON.parse(line) as OllamaChatLine;
    } catch (err) {
      throw new GatewayError('bad_response', 'Malformed line from Ollama stream', this.name, { cause: err });
    }

    if (parsed.error) {
      const code = /not found|no such model|pull the model/i.test(parsed.error)
        ? 'model_unavailable'
        : 'bad_response';
      throw new GatewayError(code, parsed.error, this.name);
    }

    const content = parsed.message?.content ?? '';
    if (content) {
      yield { delta: content, done: false };
    }

    if (parsed.done) {
      const inputTokens = parsed.prompt_eval_count;
      const outputTokens = parsed.eval_count;
      const totalTokens =
        inputTokens !== undefined && outputTokens !== undefined
          ? inputTokens + outputTokens
          : undefined;
      yield {
        delta: '',
        done: true,
        usage: {
          inputTokens,
          outputTokens,
          totalTokens,
          generationMs:
            parsed.total_duration !== undefined
              ? Math.round(parsed.total_duration / 1e6)
              : undefined,
        },
      };
    }
  }

  async health(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      const latencyMs = Date.now() - start;
      if (!res.ok) {
        return { provider: this.name, ok: false, detail: `Ollama responded ${res.status}`, latencyMs };
      }
      return { provider: this.name, ok: true, detail: 'reachable', latencyMs };
    } catch {
      return {
        provider: this.name,
        ok: false,
        detail: `unreachable at ${this.baseUrl}`,
        latencyMs: Date.now() - start,
      };
    }
  }

  /** List installed Ollama model tags (for admin diagnostics / model checks). */
  async discoverModels(): Promise<string[]> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return [];
      const data = (await res.json()) as { models?: Array<{ name?: string; model?: string }> };
      return (data.models ?? [])
        .map((m) => m.name ?? m.model)
        .filter((n): n is string => typeof n === 'string');
    } catch {
      return [];
    }
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 200);
  } catch {
    return '';
  }
}
