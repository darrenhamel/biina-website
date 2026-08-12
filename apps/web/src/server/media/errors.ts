/** Normalized multimodal errors — safe, consumer-friendly messages (no internals). */
export type MediaErrorCode =
  | 'UNSUPPORTED_MEDIA'
  | 'MEDIA_TOO_LARGE'
  | 'AUDIO_TOO_LONG'
  | 'IMAGE_TOO_LARGE'
  | 'VISION_UNAVAILABLE'
  | 'OCR_FAILED'
  | 'TRANSCRIPTION_FAILED'
  | 'TTS_FAILED'
  | 'MODEL_CAPABILITY_UNAVAILABLE'
  | 'NOT_ENTITLED'
  | 'QUOTA_EXCEEDED';

const MESSAGES: Record<MediaErrorCode, string> = {
  UNSUPPORTED_MEDIA: 'That media type is not supported.',
  MEDIA_TOO_LARGE: 'The file is too large.',
  AUDIO_TOO_LONG: 'The audio is longer than allowed.',
  IMAGE_TOO_LARGE: 'The image dimensions are too large.',
  VISION_UNAVAILABLE: 'Image understanding is temporarily unavailable.',
  OCR_FAILED: 'Text could not be extracted from the image.',
  TRANSCRIPTION_FAILED: 'The audio could not be transcribed.',
  TTS_FAILED: 'The response could not be converted to speech.',
  MODEL_CAPABILITY_UNAVAILABLE: 'No available model supports this request.',
  NOT_ENTITLED: 'Your plan does not include this feature.',
  QUOTA_EXCEEDED: 'You have reached your limit for this feature.',
};

export class MediaError extends Error {
  readonly code: MediaErrorCode;
  readonly status: number;
  readonly data?: Record<string, unknown>;
  constructor(code: MediaErrorCode, data?: Record<string, unknown>) {
    super(MESSAGES[code]);
    this.name = 'MediaError';
    this.code = code;
    this.data = data;
    this.status = code === 'NOT_ENTITLED' ? 403 : code === 'QUOTA_EXCEEDED' ? 429 : code === 'VISION_UNAVAILABLE' || code === 'OCR_FAILED' || code === 'TRANSCRIPTION_FAILED' || code === 'TTS_FAILED' ? 502 : 400;
  }
}

export const isMediaError = (e: unknown): e is MediaError => e instanceof MediaError;
