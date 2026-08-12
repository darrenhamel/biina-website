# BIINA.ai — Multimodal Activation Checklist

Exact steps to activate **real** vision / OCR / speech-to-text / text-to-speech
providers in production. Phase 14 ships fully working on **deterministic MOCK
providers** (offline); **paid external providers stay DISABLED until a human completes
the steps below.** No paid vendor is auto-activated, and **no silent paid call** is
ever made. **Do not invent credentials** — every key/endpoint is created by a human in
a provider console. Companion: `MULTIMODAL_ARCHITECTURE.md`, `VISION.md`, `OCR.md`,
`SPEECH_TO_TEXT.md`, `TEXT_TO_SPEECH.md`, `VOICE_MODE.md`, `MULTIMODAL_SECURITY.md`,
`MULTIMODAL_COSTS.md`.

## Completed in code (no action needed)

- Provider-independent services + interfaces (`VisionProvider` / `OCRProvider` /
  `SpeechToTextProvider` / `TextToSpeechProvider`) with **MOCK defaults**, registries,
  and test-injection setters — `providers.ts`.
- Server-side upload validation: magic-byte sniffing (declared type never trusted),
  size limits, header-only dimensions + decompression-bomb guard, opaque-byte storage —
  `validation.ts`, `service.ts`.
- Tenant-isolated media access (`resolveMediaAccess`, IDOR-safe → null → 404),
  attachment-only byte delivery (`nosniff`), soft-delete + byte removal, sha256 —
  `service.ts`, `api/media/[id]`.
- OCR service (deterministic-first, idempotent jobs), STT (transcript + segments in
  `audio_transcripts`), TTS (per-user AUDIO asset, never global), the logical voice
  registry (English + Arabic seeded) — `ocr.ts`, `stt.ts`, `tts.ts`, `voices.ts`.
- ContextEngine extension (image understanding + untrusted OCR + audio transcript), the
  `media` system-prompt layer, and the chat route `mediaIds` integration —
  `context.ts`, `system-prompt.ts`, `api/ai/chat`.
- Metering + entitlement/quota gates (`media_usage_events`, `assertVision/Ocr/Stt/Tts`)
  + admin overview (`multimodalOverview`) — `usage.ts`, `admin.ts`, `api/admin/multimodal`.
- Schema: `media_assets`, `media_processing_jobs`, `audio_transcripts`,
  `voice_profiles`, `media_usage_events`; `messages.mediaAssetIds`; the Phase 14 plan
  columns.

## Requires human action

### A. Confirm the platform flags

1. `MULTIMODAL_ENABLED` — leave `true` (default) to allow media; `false` disables it
   platform-wide.
2. `VOICE_MODE_ENABLED` — set `true` only when you intend to offer hands-free voice
   (default `false`).
3. Review the media limits: `MEDIA_MAX_IMAGE_BYTES` (15 MB), `MEDIA_MAX_AUDIO_BYTES`
   (40 MB), `MEDIA_MAX_IMAGE_DIMENSION` (12000). Tighten if desired.

### B. Choose vision / OCR / STT / TTS providers + voices

1. Decide each modality **independently** — vision, OCR, STT, and TTS need not share a
   vendor. For each you activate, implement/enable its real adapter behind the existing
   interface and select it via config: `VISION_PROVIDER`/`VISION_MODEL`,
   `OCR_PROVIDER`/`OCR_MODEL`, `STT_PROVIDER`/`STT_MODEL`,
   `TTS_PROVIDER`/`TTS_VOICE_DEFAULT`. Any modality left unset keeps the mock.
2. Seed/enable the **voice registry** (`voice_profiles`): map each BIINA voice slug
   (e.g. `biina-en-1`, `biina-ar-1`) to the vendor's provider voice id. **Provider voice
   ids stay server-side** and are never returned by `GET /api/voices`.

### C. Configure keys / endpoints (server-side only)

1. Provider **secrets and base URLs** reuse the existing provider-config conventions —
   set them in the **server environment / secret manager**, never in `.env` committed to
   git, never shipped to the browser, never logged.
2. Confirm the **file-storage** backing for media bytes is configured (media reuses the
   Phase 8 storage abstraction) and that storage `health` is green in the admin overview.

### D. Set plan limits (product policy lives in plans/DB, not env)

1. Set the Phase 14 plan columns per tier: `visionEnabled`, `maxImagesPerRequest`,
   `imageUploadsPerDay`, `ocrEnabled`, `ocrPagesPerMonth`, `speechToTextEnabled`,
   `audioMinutesPerMonth`, `textToSpeechEnabled`, `ttsCharactersPerMonth`,
   `voiceModeEnabled`, `voiceMinutesPerMonth`, `mediaStorageBytesLimit`.
2. If you configured a real provider, set its **cost rates** so `estimatedCost` is
   populated (readiness — see `MULTIMODAL_COSTS.md`).

## Verification (do before opening to users)

- ☐ **Upload validation** — a mislabeled file (wrong `Content-Type`) is rejected by
  magic-byte sniffing; oversize / over-dimension files return `MEDIA_TOO_LARGE` /
  `IMAGE_TOO_LARGE`.
- ☐ **Arabic** — OCR and STT return correct `language` on Arabic and mixed EN/AR
  content; an Arabic voice (`biina-ar-1`) synthesizes.
- ☐ **Mobile mic + camera/photo upload** — recording audio and attaching a camera photo
  work from a phone browser.
- ☐ **Cost metering** — vision/OCR/STT/TTS each write a `media_usage_event` with
  provider-reported units; the admin dashboard shows usage, errors, and health.
- ☐ **Entitlements** — a plan with a feature off returns `NOT_ENTITLED`; exceeding a
  limit returns `QUOTA_EXCEEDED` with the right scope.
- ☐ **Agent approval through voice** — a high-impact action requested by voice still
  pauses for the normal approval UI; no loose spoken "yes" executes it.
- ☐ **Media deletion / retention** — `DELETE /api/media/[id]` removes the bytes and the
  asset resolves to 404 afterward; confirm conversations keep the transcript, not raw
  audio.
- ☐ **Privacy** — confirm EXIF/metadata is not forwarded to the provider and not exposed
  via any API; bytes are served as an attachment with `nosniff`.

## Reminder

Activating a real provider means **real, paid external calls**. Nothing here is
autonomous: BIINA answers on the offline mock until a human completes A–D, and **voice
never bypasses approval**.
