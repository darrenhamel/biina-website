/**
 * Client-side "Voice & Media" preferences.
 *
 * Phase 14 has no server settings API for these; they are stored in the browser
 * (localStorage) and shared between the settings panel and the chat surface. A
 * change dispatches `biina:voice-media-change` so open surfaces stay in sync.
 */

export interface VoiceMediaSettings {
  /** Allow reading answers aloud + enable voice mode in chat. */
  voiceResponsesEnabled: boolean;
  /** Preferred TTS voice slug; '' means let the server choose. */
  preferredVoice: string;
  /** Audio playback rate, 0.5–2. */
  playbackSpeed: number;
  /** After a voice turn, auto-read the answer aloud. */
  autoPlayInVoiceMode: boolean;
}

export const DEFAULT_VOICE_MEDIA_SETTINGS: VoiceMediaSettings = {
  voiceResponsesEnabled: false,
  preferredVoice: '',
  playbackSpeed: 1,
  autoPlayInVoiceMode: true,
};

const STORAGE_KEY = 'biina.voiceMedia';
export const VOICE_MEDIA_CHANGE_EVENT = 'biina:voice-media-change';

export function loadVoiceMediaSettings(): VoiceMediaSettings {
  if (typeof window === 'undefined') return { ...DEFAULT_VOICE_MEDIA_SETTINGS };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_VOICE_MEDIA_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<VoiceMediaSettings>;
    return {
      voiceResponsesEnabled:
        typeof parsed.voiceResponsesEnabled === 'boolean'
          ? parsed.voiceResponsesEnabled
          : DEFAULT_VOICE_MEDIA_SETTINGS.voiceResponsesEnabled,
      preferredVoice: typeof parsed.preferredVoice === 'string' ? parsed.preferredVoice : '',
      playbackSpeed:
        typeof parsed.playbackSpeed === 'number' && parsed.playbackSpeed >= 0.5 && parsed.playbackSpeed <= 2
          ? parsed.playbackSpeed
          : DEFAULT_VOICE_MEDIA_SETTINGS.playbackSpeed,
      autoPlayInVoiceMode:
        typeof parsed.autoPlayInVoiceMode === 'boolean'
          ? parsed.autoPlayInVoiceMode
          : DEFAULT_VOICE_MEDIA_SETTINGS.autoPlayInVoiceMode,
    };
  } catch {
    return { ...DEFAULT_VOICE_MEDIA_SETTINGS };
  }
}

export function saveVoiceMediaSettings(settings: VoiceMediaSettings): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    window.dispatchEvent(new CustomEvent(VOICE_MEDIA_CHANGE_EVENT));
  } catch {
    /* storage unavailable — non-fatal */
  }
}
