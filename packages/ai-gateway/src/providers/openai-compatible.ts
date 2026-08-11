import type { AIProvider, ChatChunk, ChatRequest, ProviderHealth } from '../types';
import { GatewayError } from '../errors';

/**
 * OpenAICompatibleProvider — Phase 3 readiness stub.
 *
 * This is where a production vLLM / RunPod / OpenAI-compatible endpoint will be
 * wired (SSE `/v1/chat/completions`). The class exists now so the provider
 * ROUTER and model registry already know this shape; the frontend will need
 * ZERO changes when it goes live. It is intentionally NOT active in Phase 2 —
 * calling it fails clearly rather than silently falling back to a paid model.
 *
 * Configuration (Phase 3): OPENAI_COMPATIBLE_BASE_URL / _API_KEY / _MODEL.
 * The API key is server-side only and never logged.
 */

export interface OpenAICompatibleOptions {
  baseUrl?: string;
  apiKey?: string;
  timeoutMs: number;
}

export class OpenAICompatibleProvider implements AIProvider {
  readonly name = 'openai-compatible' as const;

  constructor(private readonly opts: OpenAICompatibleOptions) {}

  // eslint-disable-next-line require-yield
  async *chat(_req: ChatRequest): AsyncIterable<ChatChunk> {
    throw new GatewayError(
      'invalid_config',
      'The openai-compatible provider is not enabled until Phase 3.',
      this.name,
    );
  }

  async health(): Promise<ProviderHealth> {
    return {
      provider: this.name,
      ok: false,
      detail: 'not enabled until Phase 3',
    };
  }
}
