# BIINA.ai — Text-to-Speech (spoken answers)

How BIINA.ai **speaks a response back**: the provider-independent
`TextToSpeechProvider`, the **logical BIINA voice registry**, and how synthesized
audio is scoped to the requesting user. TTS is **opt-in** (read-aloud / voice mode),
**never automatic** — this bounds cost. Code: `apps/web/src/server/media/tts.ts` (+
`voices.ts`, `providers.ts`). Companion:
[`MULTIMODAL_ARCHITECTURE.md`](./MULTIMODAL_ARCHITECTURE.md),
[`VOICE_MODE.md`](./VOICE_MODE.md), [`MULTIMODAL_COSTS.md`](./MULTIMODAL_COSTS.md).

## The `TextToSpeechProvider` abstraction (`providers.ts`)

```ts
interface TextToSpeechProvider {
  readonly name: string;
  synthesize(input: { text: string; providerVoiceId: string; language: string;
    format?: string; speed?: number; signal?: AbortSignal }):
    Promise<{ bytes: Buffer; mime: string; durationMs: number; characters: number }>;
  health(): Promise<{ ok: boolean; detail?: string }>;
}
```

- **MOCK default (offline, deterministic).** `MockTextToSpeechProvider` emits a tiny
  valid WAV header plus a marker carrying the spoken text — a deterministic offline
  stub for tests/demos, no network, no credentials.
- **Real adapters = readiness.** A real TTS vendor plugs in behind the same interface,
  selected by `TTS_PROVIDER` and a default voice `TTS_VOICE_DEFAULT`; not exercised
  without config. `getTtsProvider()` / `setTtsProvider()`.

## The voice registry (`voices.ts`) — logical BIINA voices

Voices are **logical BIINA identities**, decoupled from any vendor. The UI and
settings reference a **BIINA slug** (e.g. `biina-en-1`, `biina-ar-1`); the **provider
voice id stays server-side**. `voice_profiles` rows map slug → provider + provider
voice id + language/locale + enabled flag.

Seeded defaults (`DEFAULT_VOICES`) ship **English and Arabic** voices:

| Slug | Display | Language | Locale |
|---|---|---|---|
| `biina-en-1` | Biina Voice (English) | en | en-US |
| `biina-ar-1` | Biina Voice (Arabic) | ar | ar-AE |

`GET /api/voices` returns only the safe fields (`slug`, `displayName`, `language`,
`locale`) — **never** the `providerVoiceId`. `resolveVoice(slug, language)` picks the
requested voice, else the first enabled voice for the language, else any — so a
request always resolves to an allowed voice.

## Synthesis flow (`synthesizeSpeech`)

1. Trim + cap the text (max 20k chars); empty → `TTS_FAILED`.
2. `assertTts(plan, userId, characters)` — entitlement + monthly character quota.
3. Resolve the BIINA voice → its server-side `providerVoiceId`.
4. Call the provider; store the returned audio bytes via the file-storage abstraction.
5. Insert an **AUDIO `media_assets` row scoped to the requesting user/workspace**.
6. Meter a `TEXT_TO_SPEECH` event with `units = characters` (provider-reported).
7. On failure → metered + normalized to `TTS_FAILED`.

`POST /api/tts` accepts either raw `text` or a `messageId`; when a `messageId` is
given, **conversation ownership is verified** before the message text is read.

## Read-aloud vs. voice mode

Two opt-in surfaces use the same TTS service:

- **Read-aloud** — a one-shot "speak this answer" on a specific message. Gated by
  `plan.textToSpeechEnabled`.
- **Voice mode** — a hands-free turn-based conversation (record → transcribe → answer
  → speak), additionally gated by `plan.voiceModeEnabled` and the platform
  `VOICE_MODE_ENABLED` flag (default off). See [`VOICE_MODE.md`](./VOICE_MODE.md).

Neither is automatic. BIINA **never** synthesizes a response unless the user asked —
this is a deliberate cost control.

## Audio-output scoping & caching (per-user, never global)

Synthesized audio is a **new media asset owned by the requesting user/workspace** —
it is **never globally cached** or shared across users. Two people asking to hear the
same answer get two independent, tenant-isolated assets; one user's spoken audio is
never reachable by another (the same IDOR-safe `resolveMediaAccess` as any media —
see [`MULTIMODAL_SECURITY.md`](./MULTIMODAL_SECURITY.md)).

## Streaming / realtime (readiness)

The current path synthesizes a **complete** audio asset and returns its id. **Streaming
/ realtime synthesis** (playing audio as it is generated) is **readiness** — the
provider interface can accommodate it, but the shipped flow is request/response.

## Stop-playback keeps the text

Audio is an **addition** to the written answer, never a replacement. The text response
is always present and persisted; stopping or skipping playback loses nothing —
the message remains readable. TTS never suppresses the text.

## Entitlements & metering

`assertTts(plan, userId, characters)` gates on `plan.textToSpeechEnabled` and
`plan.ttsCharactersPerMonth` (rolling month). Successful synthesis records
`TEXT_TO_SPEECH` events with `units = characters`. See
[`MULTIMODAL_COSTS.md`](./MULTIMODAL_COSTS.md).
