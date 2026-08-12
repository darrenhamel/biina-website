import { MediaError } from './errors';

/**
 * Server-side media validation. NEVER trusts the browser's declared type: the
 * actual container is sniffed from magic bytes, dimensions are parsed from the
 * header (with a decompression-bomb guard), and only an allowlist of formats is
 * accepted. Bytes are treated as OPAQUE — never executed, never rendered as HTML.
 */

export type DetectedMedia =
  | { mediaType: 'IMAGE'; mimeType: string; format: 'jpeg' | 'png' | 'webp'; width: number | null; height: number | null }
  | { mediaType: 'AUDIO'; mimeType: string; format: 'mp3' | 'wav' | 'm4a' | 'webm' | 'ogg' };

const MAX_IMAGE_BYTES = Number(process.env.MEDIA_MAX_IMAGE_BYTES) || 15 * 1024 * 1024;
const MAX_AUDIO_BYTES = Number(process.env.MEDIA_MAX_AUDIO_BYTES) || 40 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = Number(process.env.MEDIA_MAX_IMAGE_DIMENSION) || 12000; // decompression-bomb guard

function startsWith(buf: Buffer, bytes: number[], offset = 0): boolean {
  if (buf.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) if (buf[offset + i] !== bytes[i]) return false;
  return true;
}
function ascii(buf: Buffer, offset: number, len: number): string {
  return buf.slice(offset, offset + len).toString('latin1');
}

/** Parse image dimensions from the header only (no full decode). */
function imageDimensions(buf: Buffer, format: 'jpeg' | 'png' | 'webp'): { width: number | null; height: number | null } {
  try {
    if (format === 'png') {
      // IHDR width/height are big-endian at offset 16/20.
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (format === 'jpeg') {
      let i = 2;
      while (i < buf.length - 9) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1];
        // SOF0..SOF15 carry frame dimensions (skip DHT/DAC/etc).
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        }
        const segLen = buf.readUInt16BE(i + 2);
        i += 2 + segLen;
      }
      return { width: null, height: null };
    }
    if (format === 'webp' && ascii(buf, 12, 4) === 'VP8X') {
      const w = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
      const h = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
      return { width: w, height: h };
    }
  } catch {
    /* header malformed → unknown dimensions */
  }
  return { width: null, height: null };
}

/** Detect + validate. Throws a typed MediaError on anything unsafe/unsupported. */
export function detectAndValidate(buf: Buffer, declaredMime?: string): DetectedMedia {
  if (buf.length === 0) throw new MediaError('UNSUPPORTED_MEDIA');

  // ---- Images ----
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return imageResult(buf, 'jpeg', 'image/jpeg');
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return imageResult(buf, 'png', 'image/png');
  if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 4) === 'WEBP') return imageResult(buf, 'webp', 'image/webp');

  // ---- Audio ----
  if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 4) === 'WAVE') return audioResult(buf, 'wav', 'audio/wav');
  if (startsWith(buf, [0x49, 0x44, 0x33]) || startsWith(buf, [0xff, 0xfb]) || startsWith(buf, [0xff, 0xf3]) || startsWith(buf, [0xff, 0xf2])) return audioResult(buf, 'mp3', 'audio/mpeg');
  if (ascii(buf, 4, 4) === 'ftyp') return audioResult(buf, 'm4a', 'audio/mp4');
  if (startsWith(buf, [0x1a, 0x45, 0xdf, 0xa3])) return audioResult(buf, 'webm', declaredMime?.startsWith('audio') ? 'audio/webm' : 'audio/webm');
  if (ascii(buf, 0, 4) === 'OggS') return audioResult(buf, 'ogg', 'audio/ogg');

  throw new MediaError('UNSUPPORTED_MEDIA');
}

function imageResult(buf: Buffer, format: 'jpeg' | 'png' | 'webp', mime: string): DetectedMedia {
  if (buf.length > MAX_IMAGE_BYTES) throw new MediaError('MEDIA_TOO_LARGE', { max: MAX_IMAGE_BYTES });
  const { width, height } = imageDimensions(buf, format);
  if ((width && width > MAX_IMAGE_DIMENSION) || (height && height > MAX_IMAGE_DIMENSION)) throw new MediaError('IMAGE_TOO_LARGE', { max: MAX_IMAGE_DIMENSION });
  return { mediaType: 'IMAGE', mimeType: mime, format, width, height };
}
function audioResult(buf: Buffer, format: 'mp3' | 'wav' | 'm4a' | 'webm' | 'ogg', mime: string): DetectedMedia {
  if (buf.length > MAX_AUDIO_BYTES) throw new MediaError('MEDIA_TOO_LARGE', { max: MAX_AUDIO_BYTES });
  return { mediaType: 'AUDIO', mimeType: mime, format };
}

export const limits = { MAX_IMAGE_BYTES, MAX_AUDIO_BYTES, MAX_IMAGE_DIMENSION };
