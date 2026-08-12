# BIINA.ai — Multimodal Costs & Entitlements

How BIINA meters and gates **media** operations. Vision, OCR, speech-to-text, and
text-to-speech have real per-unit costs when a paid vendor is configured, so they are
metered **separately from the AI text ledger** and gated by **plan entitlements** and
**org/user quotas** — before any provider is called. Code:
`apps/web/src/server/media/usage.ts` (+ `admin.ts`, `schema.ts`). Companion:
[`USAGE_METERING.md`](./USAGE_METERING.md), [`COST_CONTROLS.md`](./COST_CONTROLS.md),
[`PLANS_AND_ENTITLEMENTS.md`](./PLANS_AND_ENTITLEMENTS.md),
[`MULTIMODAL_ARCHITECTURE.md`](./MULTIMODAL_ARCHITECTURE.md).

## Media usage events (`media_usage_events`)

Every media operation records **one metering row**, separate from `usage_events` (the
text ledger). Operations:

| Operation | Unit (`unitKind`) | Recorded by |
|---|---|---|
| `VISION` | `images` | `assembleMediaContext` (vision describe) |
| `OCR` | `pages` | `runOcr` |
| `SPEECH_TO_TEXT` | `seconds` | `transcribeMedia` |
| `TEXT_TO_SPEECH` | `characters` | `synthesizeSpeech` |
| `VOICE_SESSION` | *(session accounting — reserved)* | voice mode |

Each row carries `operation`, `userId`, `organizationId`, `mediaAssetId?`, `provider`,
`units`, `unitKind`, `estimatedCost?`, `success`, `errorCode?`, `requestId?`.
**Failures are metered too** (`success = false` + `errorCode`), so error rates and
provider health are observable.

## Provider-reported units only — never invented

The load-bearing rule: **`units` is what the provider reports**, never a fabricated
figure. Vision reports images processed; STT reports seconds; TTS reports characters;
OCR reports pages. BIINA does not estimate pixels or synthesize a count — if a provider
does not report a unit, none is invented. This mirrors the honesty posture of the text
ledger (real token counts, not guesses).

## No double-counting the AI text ledger

Media metering is a **separate ledger**. A multimodal chat turn records its normal
`usage_event` for the **text** completion (tokens) **and** distinct
`media_usage_events` for the vision/OCR/STT/TTS work. The two never overlap: image or
audio processing is not folded into token counts, and tokens are not re-counted as
media units.

## Cost service (readiness)

`estimatedCost` is an **optional** field. A per-image / per-minute / per-character cost
service that multiplies provider units by a configured rate is **readiness** — the
column and the admin cost roll-up ship (summing `estimatedCost` over 30 days), but the
shipped MOCK providers report no cost, so the estimate is `0` until a real provider and
its rate card are configured. When present it is labelled an **estimate**, not a billing
figure.

## Plan entitlements (the `plans` columns)

Effective availability is **platform flag AND plan entitlement AND (where relevant) org
policy**. The Phase 14 plan columns (`null` = unlimited for a limit):

| Column | Gates |
|---|---|
| `visionEnabled` | vision at all |
| `maxImagesPerRequest` | images per single request |
| `imageUploadsPerDay` | vision images per rolling day |
| `ocrEnabled` | OCR at all |
| `ocrPagesPerMonth` | OCR pages per rolling month |
| `speechToTextEnabled` | STT at all |
| `audioMinutesPerMonth` | STT minutes per rolling month |
| `textToSpeechEnabled` | TTS at all |
| `ttsCharactersPerMonth` | TTS characters per rolling month |
| `voiceModeEnabled` | voice mode at all |
| `voiceMinutesPerMonth` | voice minutes per rolling month |
| `mediaStorageBytesLimit` | total stored media bytes (tenant) |

The gates (`usage.ts`) run **before** the provider is called:

- `assertVision(plan, userId, imageCount)` — `visionEnabled`, `maxImagesPerRequest`,
  `imageUploadsPerDay`.
- `assertOcr(plan, userId, pages)` — `ocrEnabled`, `ocrPagesPerMonth`.
- `assertStt(plan, userId, seconds)` — `speechToTextEnabled`, `audioMinutesPerMonth`
  (converted to seconds).
- `assertTts(plan, userId, characters)` — `textToSpeechEnabled`, `ttsCharactersPerMonth`.

A disabled feature → `NOT_ENTITLED` (403); an exceeded limit → `QUOTA_EXCEEDED` (429),
with a `scope` hint (`per_request` / `day` / `month` / `storage`). Rolling windows sum
**successful** units only, in UTC (day / month).

## Storage quota

`uploadMedia` enforces `plan.mediaStorageBytesLimit` against the tenant's current
non-deleted media bytes **before** storing; over-limit → `QUOTA_EXCEEDED`
(`scope: storage`). Deleting media frees the quota (soft-delete + byte removal).

## Organization quotas

For org-scoped media, entitlement and storage are evaluated against the **organization's
active plan and tenant totals**, isolated per org (personal XOR org). Org A's usage
never counts against Org B; storage sums are per-tenant.

## Budget / quota behavior

Quotas **inform and block**, they do not silently corrupt state: an over-quota request
is refused with a clear, localized `QUOTA_EXCEEDED` before any paid work, the usage
ledger only counts successful units, and there is **no silent paid call** — until a real
provider is configured and its plan entitlement is on, the deterministic mock answers at
zero cost.

## The admin cost dashboard (`multimodalOverview`)

`GET /api/admin/multimodal` returns **metadata + health only**, over a 30-day window:

- **providers** — the selected `vision` / `ocr` / `stt` / `tts` provider names.
- **health** — per-service + storage `ok` booleans.
- **usage** — summed `vision` (images), `ocr` (pages), `sttSeconds`, `ttsCharacters`,
  `voiceSessions`.
- **errors** — failed-operation count.
- **estimatedCost** — summed `estimatedCost` (0 on the mock).
- **mediaAssets** — non-deleted asset count.

It **never** exposes media content; provider selection is admin/config and secrets stay
server-side.
