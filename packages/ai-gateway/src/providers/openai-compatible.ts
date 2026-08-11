import type { AIProvider, ChatChunk, ChatRequest, ProviderHealth, UsageMeta } from '../types';
import { GatewayError, toGatewayError } from '../errors';

/**
 * OpenAICompatibleProvider — talks to ANY OpenAI-compatible chat-completions
 * endpoint over SSE (`/v1/chat/completions`). This is deliberately generic: it
 * powers vLLM, RunPod-hosted vLLM, self-hosted vLLM, and other compatible
 * inference servers. It is NOT "OpenAI" — no OpenAI SDK, no vendor coupling.
 *
 * Server-side only. The BIINA app calls the gateway; the gateway calls this
 * provider. The OpenAI SSE payload is normalized into the provider-agnostic
 * `ChatChunk` contract, so nothing above the gateway sees an SSE detail.
 *
 * RunPod is just a base URL — no RunPod-specific code lives here.
 * Docs: OpenAI Chat Completions streaming format; vLLM OpenAI server.
 */

export interface OpenAICompatibleOptions {
  baseUrl?: string;
  /** Optional Bearer token. Omit for unauthenticated private endpoints. Never logged. */
  apiKey?: string;
  timeoutMs: number;
  /** Conservative connection retries (setup only, before any bytes stream). */
  maxConnectRetries?: number;
}

interface OpenAIStreamChoiceDelta {
  role?: string;
  content?: string;
}
interface OpenAIStreamChunk {
  choices?: Array<{ delta?: OpenAIStreamChoiceDelta; finish_reason?: string | null }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
  error?: { message?: string; code?: string; type?: string } | string;
}

export class OpenAICompatibleProvider implements AIProvider {
  readonly name = 'openai-compatible' as const;
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly maxConnectRetries: number;

  constructor(opts: OpenAICompatibleOptions) {
    this.baseUrl = (opts.baseUrl ?? '').replace(/\/+$/, '');
    this.apiKey = opts.apiKey || undefined;
    this.timeoutMs = opts.timeoutMs;
    this.maxConnectRetries = Math.max(0, opts.maxConnectRetries ?? 1);
  }

  /** Build a `/v1/...` URL, tolerating base URLs that already end in `/v1`. */
  private endpoint(path: 'chat/completions' | 'models'): string {
    const base = /\/v\d+$/.test(this.baseUrl) ? this.baseUrl : `${this.baseUrl}/v1`;
    return `${base}/${path}`;
  }

  private authHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    // Bearer only when a key is configured; supports unauthenticated private endpoints.
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    return headers;
  }

  async *chat(req: ChatRequest): AsyncIterable<ChatChunk> {
    if (!this.baseUrl) {
      throw new GatewayError('invalid_config', 'OPENAI_COMPATIBLE_BASE_URL is not set', this.name);
    }
    if (!/^https?:\/\//i.test(this.baseUrl)) {
      // Defensive: endpoints come from trusted server config; reject odd schemes.
      throw new GatewayError('invalid_config', 'OPENAI_COMPATIBLE_BASE_URL must be http(s)', this.name);
    }
    if (req.signal?.aborted) return; // clean stop, no request made

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    req.signal?.addEventListener('abort', onAbort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);

    const body = JSON.stringify({
      model: req.model,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
      // Ask compatible servers (vLLM, OpenAI) to emit a final usage chunk.
      stream_options: { include_usage: true },
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    });

    let res: Response;
    try {
      res = await this.connect(body, controller.signal, req.signal, () => timedOut);
    } catch (err) {
      clearTimeout(timer);
      req.signal?.removeEventListener('abort', onAbort);
      throw err;
    }

    try {
      this.assertOkOrThrow(res, await this.peekErrorBody(res));

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let usage: UsageMeta | undefined;
      let emittedDone = false;

      const flushLine = (line: string): ChatChunk[] => {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) return [];
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') {
          emittedDone = true;
          return [{ delta: '', done: true, usage }];
        }
        let obj: OpenAIStreamChunk;
        try {
          obj = JSON.parse(payload) as OpenAIStreamChunk;
        } catch (err) {
          throw new GatewayError('bad_response', 'Malformed SSE data from provider', this.name, { cause: err });
        }
        if (obj.error) {
          const msg = typeof obj.error === 'string' ? obj.error : obj.error.message ?? 'provider error';
          throw new GatewayError(/model/i.test(msg) ? 'model_unavailable' : 'bad_response', msg, this.name);
        }
        if (obj.usage) {
          usage = {
            inputTokens: obj.usage.prompt_tokens,
            outputTokens: obj.usage.completion_tokens,
            totalTokens: obj.usage.total_tokens,
          };
        }
        const content = obj.choices?.[0]?.delta?.content;
        return content ? [{ delta: content, done: false }] : [];
      };

      while (true) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await reader.read();
        } catch (err) {
          if (req.signal?.aborted) return; // clean stop
          if (timedOut) throw new GatewayError('timeout', 'Provider stream timed out', this.name, { cause: err });
          throw toGatewayError(err, this.name);
        }
        if (chunk.done) break;

        buffer += decoder.decode(chunk.value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          for (const out of flushLine(line)) yield out;
        }
      }
      // Trailing buffered line + terminal done if the server closed without [DONE].
      for (const out of flushLine(buffer)) yield out;
      if (!emittedDone) yield { delta: '', done: true, usage };
    } finally {
      clearTimeout(timer);
      req.signal?.removeEventListener('abort', onAbort);
    }
  }

  /**
   * Establish the streaming connection. Retries ONLY transient connection
   * failures, and ONLY before any bytes have been read (no duplicate generation
   * / no duplicate usage cost). HTTP error statuses are never retried here.
   */
  private async connect(
    body: string,
    signal: AbortSignal,
    callerSignal: AbortSignal | undefined,
    timedOut: () => boolean,
  ): Promise<Response> {
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        return await fetch(this.endpoint('chat/completions'), {
          method: 'POST',
          headers: this.authHeaders(),
          body,
          signal,
        });
      } catch (err) {
        if (callerSignal?.aborted) throw new GatewayError('cancelled', 'aborted', this.name, { cause: err });
        if (timedOut()) throw new GatewayError('timeout', 'Provider request timed out', this.name, { cause: err });
        if (attempt < this.maxConnectRetries) {
          attempt += 1;
          continue; // transient connect failure — safe to retry (no output yet)
        }
        throw new GatewayError('provider_unavailable', `Cannot reach inference endpoint`, this.name, { cause: err });
      }
    }
  }

  /** Map a non-OK HTTP status to a normalized GatewayError. */
  private assertOkOrThrow(res: Response, bodyPreview: string): void {
    if (res.ok && res.body) return;
    const detail = bodyPreview.slice(0, 200);
    if (res.status === 401 || res.status === 403) {
      throw new GatewayError('invalid_config', `Authentication failed (${res.status})`, this.name);
    }
    if (res.status === 400 || res.status === 404) {
      // 400 often = bad/unknown model; 404 = wrong path/model.
      const code = /model/i.test(detail) ? 'model_unavailable' : 'bad_response';
      throw new GatewayError(code, `Provider returned ${res.status}: ${detail}`, this.name);
    }
    if (res.status === 429 || res.status === 503 || res.status >= 500) {
      // Rate limited / overloaded / GPU worker unavailable / cold start / internal error.
      throw new GatewayError('provider_unavailable', `Provider returned ${res.status}`, this.name);
    }
    throw new GatewayError('bad_response', `Provider returned ${res.status}: ${detail}`, this.name);
  }

  /** Read a small error body only for non-2xx responses (leave 2xx stream intact). */
  private async peekErrorBody(res: Response): Promise<string> {
    if (res.ok) return '';
    try {
      return await res.text();
    } catch {
      return '';
    }
  }

  async health(): Promise<ProviderHealth> {
    if (!this.baseUrl) {
      return { provider: this.name, ok: false, detail: 'no base URL configured' };
    }
    const start = Date.now();
    try {
      const res = await fetch(this.endpoint('models'), {
        method: 'GET',
        headers: this.authHeaders(),
        signal: AbortSignal.timeout(8000),
      });
      const latencyMs = Date.now() - start;
      if (res.status === 401 || res.status === 403) {
        return { provider: this.name, ok: false, detail: 'authentication failed', latencyMs };
      }
      if (!res.ok) {
        return { provider: this.name, ok: false, detail: `endpoint responded ${res.status}`, latencyMs };
      }
      return { provider: this.name, ok: true, detail: 'reachable', latencyMs };
    } catch {
      return { provider: this.name, ok: false, detail: 'endpoint unreachable', latencyMs: Date.now() - start };
    }
  }

  async discoverModels(): Promise<string[]> {
    if (!this.baseUrl) return [];
    try {
      const res = await fetch(this.endpoint('models'), {
        method: 'GET',
        headers: this.authHeaders(),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return [];
      const data = (await res.json()) as { data?: Array<{ id?: string }> };
      return (data.data ?? [])
        .map((m) => m.id)
        .filter((id): id is string => typeof id === 'string');
    } catch {
      return [];
    }
  }
}
