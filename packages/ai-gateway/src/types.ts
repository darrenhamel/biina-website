/**
 * BIINA AI Gateway — shared types.
 *
 * These types are the contract between the BIINA product app and any AI
 * provider. The application (UI + API) depends ONLY on these types, never on a
 * vendor SDK. Swapping Ollama for vLLM/OpenAI/Anthropic/Gemini later is a new
 * adapter implementing `AIProvider` plus a registry entry — no app change.
 *
 * Server-side only. Never import this package into client components.
 */

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/** Token / usage accounting, provider-agnostic. Populated when available. */
export interface UsageMeta {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  /** Provider-reported generation duration in ms, when available. */
  generationMs?: number;
}

/** A single streamed chunk from a provider. */
export interface ChatChunk {
  /** Incremental text to append to the assistant message. */
  delta: string;
  /** True on the final chunk. */
  done: boolean;
  /** Present on (or before) the final chunk when the provider reports it. */
  usage?: UsageMeta;
}

export interface ChatRequest {
  /** Logical model id resolved via the model registry — NOT a hard-coded vendor name. */
  model: string;
  messages: ChatMessage[];
  /** Stream deltas (default true). Non-streaming callers can buffer the async iterable. */
  stream?: boolean;
  temperature?: number;
  /** Correlation id, generated once per request and logged (never a secret). */
  requestId: string;
  /** Enforces timeouts / cancellation from the caller. */
  signal?: AbortSignal;
}

export type ProviderName = 'mock' | 'ollama' | 'openai-compatible' | (string & {});

export interface ProviderHealth {
  provider: ProviderName;
  ok: boolean;
  /** Human-readable status; never contains secrets. */
  detail?: string;
  latencyMs?: number;
}

/**
 * The provider contract. Every adapter (mock today; Ollama + OpenAI-compatible
 * in Phase 2) implements this. Streaming-first: non-streaming is just consuming
 * the whole async iterable.
 */
export interface AIProvider {
  readonly name: ProviderName;
  chat(req: ChatRequest): AsyncIterable<ChatChunk>;
  health(): Promise<ProviderHealth>;
  /**
   * Optional development/diagnostics helper: list the model names the provider
   * currently has available. Used by the admin diagnostics endpoint to verify
   * the configured model exists. Not all providers can enumerate models.
   */
  discoverModels?(): Promise<string[]>;
}

/** What a model can do. Lets the registry advertise capabilities to callers. */
export interface ModelCapabilities {
  chat: boolean;
  streaming: boolean;
}

/** A logical model entry in the central registry. */
export interface ModelDescriptor {
  /** Stable logical id used throughout the app, e.g. "biina-dev". */
  id: string;
  /** Human label shown in UI (never the raw vendor name for consumer surfaces). */
  label: string;
  provider: ProviderName;
  /** The provider's own model name (e.g. an Ollama tag). */
  providerModel?: string;
  /** Advertised context window, when known. */
  contextTokens?: number;
  /** Whether this entry is selectable/usable. Disabled entries are ignored. */
  enabled?: boolean;
  capabilities?: ModelCapabilities;
}
