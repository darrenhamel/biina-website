# BIINA.ai — Vision (image understanding)

How BIINA.ai looks at an **image**: upload, server-side validation, the
provider-independent `VisionProvider`, and how images become model context. Vision
is BIINA's general "understand this picture" capability — distinct from **OCR**,
which extracts literal text (see [`OCR.md`](./OCR.md)). Code:
`apps/web/src/server/media/` (`validation.ts`, `providers.ts`, `service.ts`,
`context.ts`). Companion: [`MULTIMODAL_ARCHITECTURE.md`](./MULTIMODAL_ARCHITECTURE.md),
[`MULTIMODAL_SECURITY.md`](./MULTIMODAL_SECURITY.md).

## Upload & validation (`validation.ts`)

Every upload is validated **server-side**, and the browser's declared type is
**never trusted**:

- **Magic-byte sniffing.** The real container is detected from header bytes, not the
  `Content-Type`. Accepted image formats are an **allowlist**: **JPEG**
  (`FF D8 FF`), **PNG** (`89 50 4E 47 …`), and **WEBP** (`RIFF … WEBP`). Anything
  else → `UNSUPPORTED_MEDIA`.
- **Header-only dimensions.** Width/height are parsed from the header alone — PNG
  `IHDR`, JPEG `SOF0..SOF15`, WEBP `VP8X` — with **no full decode**.
- **Decompression-bomb guard.** A parsed dimension over `MEDIA_MAX_IMAGE_DIMENSION`
  (default **12000** px) → `IMAGE_TOO_LARGE`, before any decode is attempted.
- **Size limit.** Bytes over `MEDIA_MAX_IMAGE_BYTES` (default **15 MB**) →
  `MEDIA_TOO_LARGE`. (The route also enforces an outer request cap.)

Bytes are treated as **OPAQUE** — never executed, never rendered as HTML. The
detected `format`, `mimeType`, and dimensions are recorded on the `media_assets` row.

## EXIF / metadata privacy

BIINA stores the image bytes as-is but **never forwards EXIF/metadata to a model** —
the vision provider receives only the image bytes it needs to describe the picture,
and **location metadata never leaves the server**. Full re-encoding to physically
strip EXIF (and to down-size for cost) is **readiness**: the privacy posture (not
forwarding metadata, not exposing it via API) ships; a re-encode/resize preprocessing
step is the vendor-activation hop. See [`MULTIMODAL_SECURITY.md`](./MULTIMODAL_SECURITY.md).

## The `VisionProvider` abstraction (`providers.ts`)

The app depends only on this interface — never on a vendor:

```ts
interface VisionProvider {
  readonly name: string;
  describe(input: { images: ImageInput[]; prompt: string; signal?: AbortSignal }):
    Promise<{ text: string; units: number }>;  // text = plain-language understanding
  health(): Promise<{ ok: boolean; detail?: string }>;
}
```

- **MOCK default (offline, deterministic).** `MockVisionProvider` returns a stable
  "image understanding" string and reports `units = number of images`. It powers
  tests and demos with no network and no credentials.
- **Real adapters = readiness.** A real adapter is a fetch-based implementation
  behind the same interface, selected by config (`VISION_PROVIDER` / `VISION_MODEL`);
  it is **not exercised without credentials**. `getVisionProvider()` returns the mock
  unless an override is set; `setVisionProvider()` is the test-injection hook.

`units` is **provider-reported only** — the number of images processed — never an
invented figure (see [`MULTIMODAL_COSTS.md`](./MULTIMODAL_COSTS.md)).

## Vision-capable routing + fallback

Vision runs through its own service, so a model that cannot see is never silently
handed an image. Provider/model selection is **admin-configured** (`VISION_PROVIDER`,
`VISION_MODEL`), and there are **no silent paid calls** — until a real provider is
configured and its plan entitlement is on, the deterministic mock answers. If the
vision provider fails at request time, the engine meters the failure
(`VISION_UNAVAILABLE`), logs it, and **degrades gracefully** (answers from the text
context) rather than failing the whole chat; a hard entitlement/quota error still
surfaces to the client. `MODEL_CAPABILITY_UNAVAILABLE` is the normalized error for
"no available model supports this request."

## Multiple images & image references

`assembleMediaContext` accepts several images per turn (deduped, capped at 12 total
assets), gated by the plan's `maxImagesPerRequest` via `assertVision`. Images are
referenced positionally so the model and the user share a vocabulary: `Image 1`,
`Image 2`, …. The combined understanding is attached to `Image 1`, with later images
pointing at the combined block.

## Screenshots, charts, tables, handwriting

Vision commonly receives **screenshots, charts, tables, diagrams, and handwriting**.
The `media` system-prompt layer instructs the model to be honest about legibility:

> *If labels or numbers in an image are unclear, say so rather than guessing; never
> fabricate values from a chart or document you cannot read.*

For literal text in the image (a table's cells, a figure's caption, a scanned page),
BIINA runs **OCR** alongside vision and supplies that text as **untrusted data** —
see [`OCR.md`](./OCR.md). The model is told not to invent unreadable values.

## Entitlements & metering

`assertVision(plan, userId, imageCount)` gates on `plan.visionEnabled`,
`plan.maxImagesPerRequest` (per request), and `plan.imageUploadsPerDay` (rolling
day). Each successful describe records a `VISION` `media_usage_event` with
`units = images`. Details in [`MULTIMODAL_COSTS.md`](./MULTIMODAL_COSTS.md).

## Security recap

Uploads are magic-byte + size + dimension validated; bytes are opaque and served
only as an **attachment** with `nosniff` (never inline HTML); tenant isolation and
IDOR re-checks apply on every retrieval; EXIF/location never leaves the server; and
**text seen in an image is untrusted** — the classic *"SYSTEM: ignore all rules"*
image cannot instruct the model. Full detail:
[`MULTIMODAL_SECURITY.md`](./MULTIMODAL_SECURITY.md).
