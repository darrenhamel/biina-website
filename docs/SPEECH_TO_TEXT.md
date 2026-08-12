# BIINA.ai — Speech-to-Text (transcription)

How BIINA.ai turns **spoken audio into text**: upload + validation, the
provider-independent `SpeechToTextProvider`, and how a transcript enters a chat turn
as the **user's own words**. Code: `apps/web/src/server/media/stt.ts` (+
`validation.ts`, `providers.ts`, `context.ts`). Companion:
[`MULTIMODAL_ARCHITECTURE.md`](./MULTIMODAL_ARCHITECTURE.md),
[`VOICE_MODE.md`](./VOICE_MODE.md), [`MULTIMODAL_SECURITY.md`](./MULTIMODAL_SECURITY.md).

## Audio upload & validation (`validation.ts`)

Audio is validated **server-side** by magic bytes — the declared type is never
trusted. Accepted formats are an **allowlist**:

| Format | Detected by |
|---|---|
| **WAV** | `RIFF … WAVE` |
| **MP3** | `ID3` tag or MPEG frame sync (`FF FB` / `FF F3` / `FF F2`) |
| **M4A** | `ftyp` box |
| **WEBM** | EBML header (`1A 45 DF A3`) |
| **OGG** | `OggS` |

Anything else → `UNSUPPORTED_MEDIA`. Bytes over `MEDIA_MAX_AUDIO_BYTES` (default
**40 MB**) → `MEDIA_TOO_LARGE`. Bytes are stored **opaque**. Duration
(`durationMs`) is recorded on the asset where known and drives the per-minute
entitlement check; an over-long clip surfaces as `AUDIO_TOO_LONG`.

## The `SpeechToTextProvider` abstraction (`providers.ts`)

```ts
interface SpeechToTextProvider {
  readonly name: string;
  transcribe(input: { bytes: Buffer; mime: string; language?: string;
    timestamps?: boolean; signal?: AbortSignal }):
    Promise<{ text: string; language?: string;
      segments?: Array<{ start: number; end: number; text: string; speaker?: string }>;
      durationMs?: number; confidence?: number }>;
  health(): Promise<{ ok: boolean; detail?: string }>;
}
```

- **MOCK default (offline, deterministic).** `MockSpeechToTextProvider` reads a
  UTF-8 tail after a `BIINA-STT:` marker, detects Arabic script for `language`, and
  returns a single segment with `durationMs` and `confidence`. Offline, no network.
- **Real adapters = readiness.** A real STT engine — **local or cloud** — plugs in
  behind the same interface via `STT_PROVIDER` / `STT_MODEL`; not exercised without
  config. `getSttProvider()` / `setSttProvider()`.

## Transcription flow (`transcribeMedia`)

1. Assert the asset is `AUDIO` (else `UNSUPPORTED_MEDIA`).
2. `assertStt(plan, userId, seconds)` — entitlement + per-minute quota.
3. Read the opaque bytes, call the provider.
4. Store the normalized transcript in `audio_transcripts` (one per media —
   `onConflictDoUpdate`), including `segments`, `language`, `durationMs`,
   `confidence`. Text is capped at 200k chars.
5. Meter a `SPEECH_TO_TEXT` event with `units = seconds` (provider-reported).
6. On failure → metered + normalized to `TRANSCRIPTION_FAILED`.

## English, Arabic & mixed transcription; language detection

STT is **bilingual-first**. The provider returns a `language` field (the mock detects
Arabic script directly), an explicit `language` hint can be passed, and mixed
English/Arabic speech is supported at the interface. Language detection is the
provider's — BIINA records what it reports, never a guess.

## The audio → chat flow (transcript is the user's own words)

When audio is attached to a chat turn, `assembleMediaContext` transcribes it and
**appends the transcript to the user's message text**:

```
storedContent = `${message}\n${transcript}`.trim()
```

Because it is the **user's own speech**, the transcript is treated as **trusted user
input** — not as untrusted extracted text (the way OCR text is). It is then subject to
**exactly the same request-processing controls as anything the user types**: the same
routing, the same policy, the same approval gates. Speaking a request grants no more
authority than typing it. (Contrast: text *inside an image* is untrusted — see
[`OCR.md`](./OCR.md).)

## Timestamps & diarization (readiness)

The `segments` shape carries `start` / `end` and an optional `speaker`, and the
`/api/media/[id]/transcribe` route requests `timestamps: true`. Word/segment
timestamps flow through when the provider supplies them; **speaker diarization** (who
spoke when) is **readiness** — the field exists and is stored, but populating it
depends on a diarization-capable provider.

## Transcript editing (readiness)

Transcripts are stored durably and returned to the client, so a **user-edit-then-send**
flow is straightforward to layer on; an editing UI is readiness. What persists in a
conversation is the **transcript, not the raw audio** (raw-audio retention is a
separate policy — see [`MULTIMODAL_SECURITY.md`](./MULTIMODAL_SECURITY.md)).

## Entitlements & metering

`assertStt(plan, userId, seconds)` gates on `plan.speechToTextEnabled` and
`plan.audioMinutesPerMonth` (rolling month, compared in seconds). Successful
transcriptions record `SPEECH_TO_TEXT` events with `units = seconds`. See
[`MULTIMODAL_COSTS.md`](./MULTIMODAL_COSTS.md).
