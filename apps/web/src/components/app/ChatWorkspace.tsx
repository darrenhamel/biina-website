'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { Icon } from '@/components/Icon';
import { BrandMark } from '@/components/Logo';
import { KnowledgeSelector, type RagMode } from './KnowledgeSelector';
import { ConnectedSourcesSelector } from './ConnectedSourcesSelector';
import {
  DEFAULT_VOICE_MEDIA_SETTINGS,
  VOICE_MEDIA_CHANGE_EVENT,
  loadVoiceMediaSettings,
  type VoiceMediaSettings,
} from '@/lib/voice-media';

type MediaType = 'IMAGE' | 'AUDIO';

/** A media file attached to the composer (uploaded, awaiting send). */
interface Attachment {
  id: string;
  mediaType: MediaType;
  mimeType: string;
  ocrOpen?: boolean;
  ocrBusy?: boolean;
  ocrText?: string;
  ocrError?: string;
}

/** Media rendered alongside a sent message (thumbnail / player only). */
interface MessageMedia {
  id: string;
  mediaType: MediaType;
}

interface DocumentCitation {
  n: number;
  sourceType?: 'document';
  documentId?: string;
  documentName: string;
  page?: number | null;
  sectionTitle?: string | null;
  chunkId?: string;
  knowledgeBaseId?: string;
}

interface WebCitation {
  n: number;
  sourceType: 'web';
  title?: string;
  url: string;
  domain?: string;
  publishedAt?: string | null;
  retrievedAt?: string | null;
  sourceId?: string;
  kind?: string;
}

interface ConnectorCitation {
  n: number;
  sourceType: 'connector';
  connector: string;
  connectionId?: string;
  externalId?: string;
  name: string;
  resourceType?: string;
  retrievedAt?: string | null;
}

type Citation = DocumentCitation | WebCitation | ConnectorCitation;

const isWebCitation = (c: Citation): c is WebCitation => c.sourceType === 'web';
const isConnectorCitation = (c: Citation): c is ConnectorCitation => c.sourceType === 'connector';

type Freshness = 'any' | 'day' | 'week' | 'month' | 'year';

interface UiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  citations?: Citation[];
  webSearched?: boolean;
  media?: MessageMedia[];
}

function mediaErrorMessage(
  code: string | undefined,
  fallback: string | undefined,
  dict: Dictionary,
): string {
  switch (code) {
    case 'UNSUPPORTED_MEDIA':
      return dict.multimodal.errUnsupported;
    case 'MEDIA_TOO_LARGE':
      return dict.multimodal.errTooLarge;
    case 'IMAGE_TOO_LARGE':
      return dict.multimodal.errImageTooLarge;
    case 'NOT_ENTITLED':
      return dict.multimodal.errNotEntitled;
    case 'QUOTA_EXCEEDED':
      return dict.multimodal.errQuota;
    default:
      return fallback || dict.common.somethingWrong;
  }
}

function defaultMessageForAttachments(atts: Attachment[], dict: Dictionary): string {
  return atts.some((a) => a.mediaType === 'AUDIO')
    ? dict.multimodal.defaultVoiceMessage
    : dict.multimodal.defaultImageMessage;
}

let tempCounter = 0;
const tempId = () => `tmp-${Date.now()}-${tempCounter++}`;

export function ChatWorkspace({
  locale,
  dict,
  conversationId: initialConversationId,
  initialMessages,
}: {
  locale: Locale;
  dict: Dictionary;
  conversationId?: string;
  initialMessages: UiMessage[];
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<UiMessage[]>(initialMessages);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const convIdRef = useRef<string | undefined>(initialConversationId);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastUserRef = useRef<string>('');
  // User-facing model selector (BIINA names only; infra hidden).
  const [models, setModels] = useState<Array<{ slug: string; displayName: string }>>([]);
  const [model, setModel] = useState<string>('');
  // Knowledge (RAG) selection for grounding answers.
  const [knowledgeBaseIds, setKnowledgeBaseIds] = useState<string[]>([]);
  const [ragMode, setRagMode] = useState<RagMode>('off');
  // Live web-search grounding (vendor stays hidden).
  const [webSearch, setWebSearch] = useState(false);
  const [freshness, setFreshness] = useState<Freshness>('any');
  const [searching, setSearching] = useState(false);
  // Connected external sources selected for grounding.
  const [connectionIds, setConnectionIds] = useState<string[]>([]);
  // Temporary chat: no memory retrieval + no memory creation (server honors this).
  const [temporary, setTemporary] = useState(false);
  // Phase 14 — multimodal. Attached media awaiting send.
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [mediaError, setMediaError] = useState<string | null>(null);
  // Voice mode: turn-based record → send → read the answer aloud.
  const [voiceMode, setVoiceMode] = useState(false);
  // Voice & Media preferences (client-side, localStorage).
  const [voiceSettings, setVoiceSettings] = useState<VoiceMediaSettings>(DEFAULT_VOICE_MEDIA_SETTINGS);
  // Read-aloud playback (a single shared <audio> element).
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [ttsBusyId, setTtsBusyId] = useState<string | null>(null);

  // Keep state in sync when navigating between conversations.
  useEffect(() => {
    setMessages(initialMessages);
    convIdRef.current = initialConversationId;
    setError(null);
  }, [initialConversationId, initialMessages]);

  // Load + track Voice & Media preferences.
  useEffect(() => {
    const update = () => setVoiceSettings(loadVoiceMediaSettings());
    update();
    window.addEventListener(VOICE_MEDIA_CHANGE_EVENT, update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener(VOICE_MEDIA_CHANGE_EVENT, update);
      window.removeEventListener('storage', update);
    };
  }, []);

  // Voice mode is only meaningful when voice responses are enabled.
  useEffect(() => {
    if (!voiceSettings.voiceResponsesEnabled && voiceMode) setVoiceMode(false);
  }, [voiceSettings.voiceResponsesEnabled, voiceMode]);

  // Stop any playback when unmounting.
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  // ---- Media upload / attachments ----

  async function uploadMedia(file: Blob, filename: string): Promise<Attachment | null> {
    setMediaError(null);
    const form = new FormData();
    form.append('file', file, filename);
    if (convIdRef.current) form.append('conversationId', convIdRef.current);
    try {
      const res = await fetch('/api/media', { method: 'POST', body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        setMediaError(mediaErrorMessage(body.code, body.error, dict));
        return null;
      }
      return { id: body.media.id, mediaType: body.media.mediaType, mimeType: body.media.mimeType };
    } catch {
      setMediaError(dict.common.somethingWrong);
      return null;
    }
  }

  async function addImageFiles(files: File[]) {
    const images = files.filter((f) => f.type.startsWith('image/'));
    for (const f of images) {
      let full = false;
      setAttachments((prev) => {
        full = prev.length >= 12;
        return prev;
      });
      if (full) {
        setMediaError(dict.multimodal.errTooMany);
        break;
      }
      const att = await uploadMedia(f, f.name || 'image');
      if (att) setAttachments((prev) => (prev.length >= 12 ? prev : [...prev, att]));
    }
  }

  async function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
    try {
      await fetch(`/api/media/${id}`, { method: 'DELETE' });
    } catch {
      /* best-effort cleanup */
    }
  }

  async function runOcr(id: string) {
    setAttachments((prev) =>
      prev.map((a) => (a.id === id ? { ...a, ocrOpen: true, ocrBusy: true, ocrError: undefined } : a)),
    );
    try {
      const res = await fetch(`/api/media/${id}/ocr`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        setAttachments((prev) =>
          prev.map((a) =>
            a.id === id ? { ...a, ocrBusy: false, ocrError: body.error || dict.common.somethingWrong } : a,
          ),
        );
        return;
      }
      setAttachments((prev) =>
        prev.map((a) => (a.id === id ? { ...a, ocrBusy: false, ocrText: body.text ?? '' } : a)),
      );
    } catch {
      setAttachments((prev) =>
        prev.map((a) => (a.id === id ? { ...a, ocrBusy: false, ocrError: dict.common.somethingWrong } : a)),
      );
    }
  }

  // ---- Read-aloud (TTS) ----

  function stopSpeaking() {
    const el = audioRef.current;
    if (el) {
      el.pause();
      el.currentTime = 0;
    }
    setPlayingId(null);
  }

  async function readAloud(id: string, text: string) {
    const clean = text.trim();
    if (!clean) return;
    stopSpeaking();
    setTtsBusyId(id);
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: clean,
          ...(voiceSettings.preferredVoice ? { voiceSlug: voiceSettings.preferredVoice } : {}),
          language: locale === 'ar' ? 'ar' : 'en',
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        setError(body.error || dict.common.somethingWrong);
        return;
      }
      let el = audioRef.current;
      if (!el) {
        el = new Audio();
        el.onended = () => setPlayingId(null);
        el.onerror = () => setPlayingId(null);
        audioRef.current = el;
      }
      el.src = `/api/media/${body.mediaId}`;
      el.playbackRate = voiceSettings.playbackSpeed || 1;
      setPlayingId(id);
      // Playback follows a user gesture (button / voice turn); may still be blocked.
      await el.play().catch(() => setPlayingId(null));
    } catch {
      setError(dict.common.somethingWrong);
    } finally {
      setTtsBusyId(null);
    }
  }

  // Voice mode: after a recording uploads, auto-send this turn.
  async function onRecorded(blob: Blob) {
    const att = await uploadMedia(blob, 'voice-note.webm');
    if (!att) return;
    if (voiceMode) {
      let current: Attachment[] = [];
      setAttachments((prev) => {
        current = prev;
        return prev;
      });
      void send('', { fromVoice: true, attachmentsOverride: [...current, att] });
    } else {
      setAttachments((prev) => [...prev, att]);
    }
  }

  // Load the models this user may pick (only shown if there's a real choice).
  useEffect(() => {
    let active = true;
    fetch('/api/ai/models')
      .then((r) => (r.ok ? r.json() : { models: [] }))
      .then((d) => {
        if (active) setModels(d.models ?? []);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  async function send(
    text: string,
    opts?: { fromVoice?: boolean; attachmentsOverride?: Attachment[] },
  ) {
    const atts = opts?.attachmentsOverride ?? attachments;
    const typed = text.trim();
    if ((!typed && atts.length === 0) || busy) return;
    // Media attached but no text? Use a sensible default so the turn is valid.
    const content = typed || defaultMessageForAttachments(atts, dict);
    setError(null);
    setMediaError(null);
    lastUserRef.current = content;

    const mediaIds = atts.map((a) => a.id);
    const userMsg: UiMessage = {
      id: tempId(),
      role: 'user',
      content,
      ...(atts.length > 0
        ? { media: atts.map((a) => ({ id: a.id, mediaType: a.mediaType })) }
        : {}),
    };
    const assistantMsg: UiMessage = { id: tempId(), role: 'assistant', content: '', streaming: true };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput('');
    setAttachments([]);
    setBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;
    const hadConversation = Boolean(convIdRef.current);
    const useRag = knowledgeBaseIds.length > 0 && ragMode !== 'off';
    if (webSearch) setSearching(true);
    let citations: Citation[] | undefined;
    let webSearched = false;
    let assistantText = '';

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: convIdRef.current,
          message: content,
          model: model || undefined,
          ...(useRag ? { knowledgeBaseIds, ragMode } : {}),
          ...(webSearch ? { webSearch: true, freshness } : {}),
          ...(connectionIds.length > 0 ? { connectionIds } : {}),
          ...(temporary ? { temporary: true } : {}),
          ...(mediaIds.length > 0 ? { mediaIds } : {}),
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || dict.common.somethingWrong);
      }

      const newConvId = res.headers.get('X-Biina-Conversation-Id') ?? undefined;
      if (newConvId) convIdRef.current = newConvId;

      const answerMode = res.headers.get('X-Biina-Answer-Mode') ?? '';
      webSearched = answerMode.includes('WEB');
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantMsg.id ? { ...m, webSearched } : m)),
      );

      const citHeader = res.headers.get('X-Biina-Citations');
      if (citHeader) {
        try {
          citations = JSON.parse(decodeURIComponent(citHeader)) as Citation[];
        } catch {
          citations = undefined;
        }
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        setSearching(false);
        const chunk = decoder.decode(value, { stream: true });
        assistantText += chunk;
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantMsg.id ? { ...m, content: m.content + chunk } : m)),
        );
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError((err as Error).message || dict.common.somethingWrong);
      }
    } finally {
      setBusy(false);
      setSearching(false);
      abortRef.current = null;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsg.id
            ? { ...m, streaming: false, citations: citations ?? m.citations, webSearched }
            : m,
        ),
      );

      // Voice mode: read the answer aloud automatically (turn-based).
      if (
        opts?.fromVoice &&
        voiceSettings.voiceResponsesEnabled &&
        voiceSettings.autoPlayInVoiceMode &&
        assistantText.trim().length > 0
      ) {
        void readAloud(assistantMsg.id, assistantText);
      }

      // For a brand-new conversation, reflect the id in the URL + refresh the sidebar.
      if (!hadConversation && convIdRef.current) {
        window.history.replaceState(null, '', `/${locale}/app/chat/${convIdRef.current}`);
      }
      router.refresh();
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  function regenerate() {
    if (busy || !lastUserRef.current) return;
    // Drop the last assistant turn from the view and re-ask the last question.
    setMessages((prev) => {
      const copy = [...prev];
      if (copy.at(-1)?.role === 'assistant') copy.pop();
      return copy;
    });
    void send(lastUserRef.current);
  }

  const isEmpty = messages.length === 0;

  return (
    <div className="flex h-full flex-col bg-paper-sunken">
      <div ref={scrollRef} className="scroll-slim min-h-0 flex-1 overflow-y-auto">
        {isEmpty ? (
          <EmptyState dict={dict} onPick={(p) => send(p)} />
        ) : (
          <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6">
            {messages.map((m) => (
              <MessageRow
                key={m.id}
                message={m}
                dict={dict}
                locale={locale}
                searching={searching}
                voiceEnabled={voiceSettings.voiceResponsesEnabled}
                isPlaying={playingId === m.id}
                isTtsBusy={ttsBusyId === m.id}
                onReadAloud={() => readAloud(m.id, m.content)}
                onStopSpeaking={stopSpeaking}
              />
            ))}
            {error && (
              <div className="mx-auto my-3 max-w-prose rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">
                {error}
                <button onClick={regenerate} className="ms-2 font-semibold underline">
                  {dict.common.retry}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <Composer
        dict={dict}
        input={input}
        setInput={setInput}
        busy={busy}
        onSend={() => send(input)}
        onStop={stop}
        onRegenerate={regenerate}
        canRegenerate={!isEmpty && !busy}
        models={models}
        model={model}
        setModel={setModel}
        knowledgeBaseIds={knowledgeBaseIds}
        setKnowledgeBaseIds={setKnowledgeBaseIds}
        ragMode={ragMode}
        setRagMode={setRagMode}
        webSearch={webSearch}
        setWebSearch={setWebSearch}
        freshness={freshness}
        setFreshness={setFreshness}
        connectionIds={connectionIds}
        setConnectionIds={setConnectionIds}
        temporary={temporary}
        setTemporary={setTemporary}
        attachments={attachments}
        onAddImages={addImageFiles}
        onRemoveAttachment={removeAttachment}
        onRunOcr={runOcr}
        mediaError={mediaError}
        voiceEnabled={voiceSettings.voiceResponsesEnabled}
        voiceMode={voiceMode}
        setVoiceMode={setVoiceMode}
        onRecorded={onRecorded}
      />
    </div>
  );
}

function EmptyState({ dict, onPick }: { dict: Dictionary; onPick: (p: string) => void }) {
  const suggestions = [
    'Explain how BIINA stays independent of any single AI model.',
    'اكتب رسالة ترحيب قصيرة لطلاب جدد.',
    'Give me three ideas for a science project.',
  ];
  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center px-6 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-2xl bg-accent-soft text-accent">
        <BrandMark size={30} />
      </div>
      <h1 className="mt-5 text-2xl font-bold tracking-tight text-ink">{dict.chat.emptyTitle}</h1>
      <p className="mt-2 text-ink-soft">{dict.chat.emptySubtitle}</p>
      <div className="mt-6 grid w-full gap-2 sm:grid-cols-3">
        {suggestions.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="card p-3 text-start text-sm text-ink-soft transition-colors hover:border-accent hover:text-ink"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageRow({
  message,
  dict,
  locale,
  searching,
  voiceEnabled,
  isPlaying,
  isTtsBusy,
  onReadAloud,
  onStopSpeaking,
}: {
  message: UiMessage;
  dict: Dictionary;
  locale: Locale;
  searching: boolean;
  voiceEnabled: boolean;
  isPlaying: boolean;
  isTtsBusy: boolean;
  onReadAloud: () => void;
  onStopSpeaking: () => void;
}) {
  const isUser = message.role === 'user';
  const isSearching = !isUser && searching && message.streaming && message.content.length === 0;
  return (
    <div className="group py-4">
      <div className="flex gap-3">
        <div
          className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-xs font-semibold ${
            isUser ? 'bg-ink text-paper' : 'bg-accent text-on-accent'
          }`}
          aria-hidden
        >
          {isUser ? dict.chat.you.charAt(0) : <BrandMark size={18} />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="mb-1 text-xs font-semibold text-ink-soft">
            {isUser ? dict.chat.you : dict.chat.assistant}
          </p>
          {!isUser && message.webSearched && (
            <span className="mb-1.5 inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
              <Icon name="globe" width={12} height={12} />
              {dict.web.searchedWeb}
            </span>
          )}
          <div className="prose-chat text-[15px] text-ink">
            {message.content}
            {message.streaming && message.content.length === 0 ? (
              <span className="inline-flex items-center gap-1.5 text-ink-faint">
                {isSearching && (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-line-strong border-t-accent" />
                )}
                {isSearching ? dict.web.searching : dict.chat.thinking}
              </span>
            ) : null}
            {message.streaming && message.content.length > 0 ? (
              <span className="ms-0.5 inline-block h-4 w-1.5 animate-blink bg-accent align-middle" />
            ) : null}
          </div>
          {message.media && message.media.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {message.media.map((m) =>
                m.mediaType === 'IMAGE' ? (
                  // Private, access-checked bytes — only ever the /api/media/[id] route.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={m.id}
                    src={`/api/media/${m.id}`}
                    alt={dict.multimodal.imageAlt}
                    className="h-24 w-24 rounded-lg border border-line object-cover"
                  />
                ) : (
                  <span
                    key={m.id}
                    className="inline-flex items-center gap-2 rounded-lg border border-line bg-paper-sunken px-2 py-1"
                  >
                    <Icon name="mic" width={14} height={14} />
                    <audio controls src={`/api/media/${m.id}`} className="h-8 max-w-[220px]" />
                  </span>
                ),
              )}
            </div>
          )}
          {!isUser && message.citations && message.citations.length > 0 && (
            <Citations citations={message.citations} dict={dict} locale={locale} />
          )}
          {!isUser && !message.streaming && message.content.length > 0 && (
            <MessageActions
              content={message.content}
              dict={dict}
              voiceEnabled={voiceEnabled}
              isPlaying={isPlaying}
              isTtsBusy={isTtsBusy}
              onReadAloud={onReadAloud}
              onStopSpeaking={onStopSpeaking}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function MessageActions({
  content,
  dict,
  voiceEnabled,
  isPlaying,
  isTtsBusy,
  onReadAloud,
  onStopSpeaking,
}: {
  content: string;
  dict: Dictionary;
  voiceEnabled: boolean;
  isPlaying: boolean;
  isTtsBusy: boolean;
  onReadAloud: () => void;
  onStopSpeaking: () => void;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }
  return (
    <div className="mt-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
      <button
        onClick={copy}
        className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-ink-soft hover:bg-paper-sunken"
      >
        <Icon name={copied ? 'check' : 'copy'} width={14} height={14} />
        {copied ? dict.common.copied : dict.common.copy}
      </button>
      {voiceEnabled &&
        (isPlaying ? (
          <button
            onClick={onStopSpeaking}
            aria-label={dict.multimodal.stopSpeaking}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-accent hover:bg-paper-sunken"
          >
            <Icon name="stop" width={14} height={14} />
            {dict.multimodal.stopSpeaking}
          </button>
        ) : (
          <button
            onClick={onReadAloud}
            disabled={isTtsBusy}
            aria-label={dict.multimodal.readAloud}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-ink-soft hover:bg-paper-sunken disabled:opacity-60"
          >
            <Icon name="volume" width={14} height={14} />
            {isTtsBusy ? dict.multimodal.preparingAudio : dict.multimodal.readAloud}
          </button>
        ))}
      <span className="ms-1 text-[11px] text-ink-faint">{dict.chat.devProviderNote}</span>
    </div>
  );
}

function Citations({
  citations,
  dict,
  locale,
}: {
  citations: Citation[];
  dict: Dictionary;
  locale: Locale;
}) {
  const docs = citations.filter(
    (c): c is DocumentCitation => !isWebCitation(c) && !isConnectorCitation(c),
  );
  const webs = citations.filter(isWebCitation);
  const connectors = citations.filter(isConnectorCitation);
  const fmtDate = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-US', {
    dateStyle: 'medium',
  });

  return (
    <div className="mt-3 space-y-2">
      {docs.length > 0 && (
        <div className="rounded-xl border border-line bg-paper-sunken px-3 py-2">
          <p className="text-xs font-semibold text-ink-soft">{dict.rag.sources}</p>
          <ul className="mt-1 space-y-0.5">
            {docs.map((c) => (
              <li key={`d-${c.n}-${c.chunkId ?? c.documentId}`} className="text-xs text-ink-soft">
                <span className="font-semibold text-ink">[{c.n}]</span> {c.documentName}
                {c.page != null && (
                  <span className="text-ink-faint">
                    {' '}
                    — {dict.rag.page} {c.page}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {webs.length > 0 && (
        <div className="rounded-xl border border-line bg-paper-sunken px-3 py-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-soft">
            <Icon name="globe" width={12} height={12} />
            {dict.web.sources}
          </p>
          <ul className="mt-1 space-y-1">
            {webs.map((c) => {
              const isPublic = /^https?:\/\//i.test(c.url);
              const label = c.title || c.domain || c.url;
              return (
                <li key={`w-${c.n}-${c.sourceId ?? c.url}`} className="text-xs text-ink-soft">
                  <span className="font-semibold text-ink">[{c.n}]</span>{' '}
                  {isPublic ? (
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-accent underline decoration-line hover:decoration-accent"
                    >
                      {label}
                    </a>
                  ) : (
                    <span className="text-ink">{label}</span>
                  )}
                  {c.domain && <span className="text-ink-faint"> — {c.domain}</span>}
                  {c.publishedAt && (
                    <span className="text-ink-faint"> · {fmtDate.format(new Date(c.publishedAt))}</span>
                  )}
                  {c.retrievedAt && (
                    <span className="text-ink-faint">
                      {' '}
                      · {dict.web.retrieved} {fmtDate.format(new Date(c.retrievedAt))}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {connectors.length > 0 && (
        <div className="rounded-xl border border-line bg-paper-sunken px-3 py-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-soft">
            <Icon name="spark" width={12} height={12} />
            {dict.connectors.sources}
          </p>
          <ul className="mt-1 space-y-0.5">
            {connectors.map((c) => (
              <li key={`c-${c.n}-${c.connectionId ?? c.externalId ?? c.name}`} className="text-xs text-ink-soft">
                <span className="font-semibold text-ink">[{c.n}]</span> {c.name}
                <span className="text-ink-faint"> — {c.connector}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Composer({
  dict,
  input,
  setInput,
  busy,
  onSend,
  onStop,
  onRegenerate,
  canRegenerate,
  models,
  model,
  setModel,
  knowledgeBaseIds,
  setKnowledgeBaseIds,
  ragMode,
  setRagMode,
  webSearch,
  setWebSearch,
  freshness,
  setFreshness,
  connectionIds,
  setConnectionIds,
  temporary,
  setTemporary,
  attachments,
  onAddImages,
  onRemoveAttachment,
  onRunOcr,
  mediaError,
  voiceEnabled,
  voiceMode,
  setVoiceMode,
  onRecorded,
}: {
  dict: Dictionary;
  input: string;
  setInput: (v: string) => void;
  busy: boolean;
  onSend: () => void;
  onStop: () => void;
  onRegenerate: () => void;
  canRegenerate: boolean;
  models: Array<{ slug: string; displayName: string }>;
  model: string;
  setModel: (v: string) => void;
  knowledgeBaseIds: string[];
  setKnowledgeBaseIds: (ids: string[]) => void;
  ragMode: RagMode;
  setRagMode: (mode: RagMode) => void;
  webSearch: boolean;
  setWebSearch: (v: boolean) => void;
  freshness: Freshness;
  setFreshness: (v: Freshness) => void;
  connectionIds: string[];
  setConnectionIds: (ids: string[]) => void;
  temporary: boolean;
  setTemporary: (v: boolean) => void;
  attachments: Attachment[];
  onAddImages: (files: File[]) => void;
  onRemoveAttachment: (id: string) => void;
  onRunOcr: (id: string) => void;
  mediaError: string | null;
  voiceEnabled: boolean;
  voiceMode: boolean;
  setVoiceMode: (v: boolean) => void;
  onRecorded: (blob: Blob) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Mic recording (client-only; feature-detected).
  const [recording, setRecording] = useState(false);
  const [recError, setRecError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const cancelRef = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  // Never leave the mic open past unmount.
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  }

  function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData?.items ?? [])
      .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
      .map((it) => it.getAsFile())
      .filter((f): f is File => Boolean(f));
    if (files.length > 0) {
      e.preventDefault();
      onAddImages(files);
    }
  }

  function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (files.length > 0) onAddImages(files);
    e.target.value = '';
  }

  async function startRecording() {
    setRecError(null);
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === 'undefined'
    ) {
      setRecError(dict.multimodal.micUnsupported);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      cancelRef.current = false;
      const rec = new MediaRecorder(stream);
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        setRecording(false);
        const parts = chunksRef.current;
        chunksRef.current = [];
        if (cancelRef.current) return;
        const blob = new Blob(parts, { type: rec.mimeType || 'audio/webm' });
        if (blob.size > 0) onRecorded(blob);
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
    } catch (err) {
      setRecError(
        (err as Error).name === 'NotAllowedError'
          ? dict.multimodal.micDenied
          : dict.multimodal.micError,
      );
    }
  }

  function stopRecording() {
    cancelRef.current = false;
    recorderRef.current?.stop();
  }

  function cancelRecording() {
    cancelRef.current = true;
    recorderRef.current?.stop();
  }

  return (
    <div className="shrink-0 border-t border-line bg-paper px-4 py-3 md:px-6">
      <div className="mx-auto max-w-3xl">
        {models.length > 1 && (
          <div className="mb-2 flex justify-center">
            <label className="inline-flex items-center gap-1.5 text-xs text-ink-soft">
              <span className="sr-only">Model</span>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="rounded-lg border border-line bg-paper-raised px-2 py-1 text-xs text-ink focus:border-accent focus:outline-none"
                aria-label="Model"
              >
                <option value="">{dict.chat.assistant}</option>
                {models.map((m) => (
                  <option key={m.slug} value={m.slug}>
                    {m.displayName}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        {canRegenerate && (
          <div className="mb-2 flex justify-center">
            <button onClick={onRegenerate} className="btn-outline px-3 py-1.5 text-xs">
              <Icon name="regenerate" width={14} height={14} />
              {dict.chat.regenerate}
            </button>
          </div>
        )}
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <KnowledgeSelector
            dict={dict}
            selected={knowledgeBaseIds}
            onSelectedChange={setKnowledgeBaseIds}
            mode={ragMode}
            onModeChange={setRagMode}
          />
          <ConnectedSourcesSelector
            dict={dict}
            selected={connectionIds}
            onSelectedChange={setConnectionIds}
          />
          <button
            type="button"
            onClick={() => setWebSearch(!webSearch)}
            aria-pressed={webSearch}
            className={`gap-1.5 px-3 py-1.5 text-xs ${webSearch ? 'btn-primary' : 'btn-outline'}`}
          >
            <Icon name="globe" width={14} height={14} />
            <span className="truncate">{webSearch ? dict.web.on : dict.web.search}</span>
          </button>
          {webSearch && (
            <label className="inline-flex items-center gap-1.5 text-xs text-ink-soft">
              <span className="sr-only">{dict.web.freshness}</span>
              <select
                value={freshness}
                onChange={(e) => setFreshness(e.target.value as Freshness)}
                className="rounded-lg border border-line bg-paper-raised px-2 py-1 text-xs text-ink focus:border-accent focus:outline-none"
                aria-label={dict.web.freshness}
              >
                <option value="any">{dict.web.freshAny}</option>
                <option value="day">{dict.web.freshDay}</option>
                <option value="week">{dict.web.freshWeek}</option>
                <option value="month">{dict.web.freshMonth}</option>
                <option value="year">{dict.web.freshYear}</option>
              </select>
            </label>
          )}
          <button
            type="button"
            onClick={() => setTemporary(!temporary)}
            aria-pressed={temporary}
            title={dict.chat.temporaryHint}
            className={`gap-1.5 px-3 py-1.5 text-xs ${temporary ? 'btn-primary' : 'btn-outline'}`}
          >
            <Icon name="clock" width={14} height={14} />
            <span className="truncate">{temporary ? dict.chat.temporaryOn : dict.chat.temporary}</span>
          </button>
          {voiceEnabled && (
            <button
              type="button"
              onClick={() => setVoiceMode(!voiceMode)}
              aria-pressed={voiceMode}
              title={dict.multimodal.voiceModeHint}
              className={`gap-1.5 px-3 py-1.5 text-xs ${voiceMode ? 'btn-primary' : 'btn-outline'}`}
            >
              <Icon name="volume" width={14} height={14} />
              <span className="truncate">
                {voiceMode ? dict.multimodal.voiceModeOn : dict.multimodal.voiceMode}
              </span>
            </button>
          )}
        </div>

        {/* Attachment previews */}
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((a) => (
              <AttachmentChip
                key={a.id}
                attachment={a}
                dict={dict}
                onRemove={() => onRemoveAttachment(a.id)}
                onRunOcr={() => onRunOcr(a.id)}
              />
            ))}
          </div>
        )}

        {(mediaError || recError) && (
          <p role="alert" className="mb-2 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
            {mediaError || recError}
          </p>
        )}
        <div className="flex items-end gap-2 rounded-2xl border border-line-strong bg-paper-raised p-2 focus-within:border-accent">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            onChange={onPickFiles}
            className="hidden"
            aria-hidden="true"
            tabIndex={-1}
          />
          {recording ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={stopRecording}
                className="btn-primary gap-1.5 p-2.5"
                aria-label={dict.multimodal.stopRecording}
                title={dict.multimodal.stopRecording}
              >
                <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-on-accent" />
                <Icon name="stop" width={16} height={16} />
              </button>
              <button
                type="button"
                onClick={cancelRecording}
                className="btn-outline p-2.5"
                aria-label={dict.multimodal.cancelRecording}
                title={dict.multimodal.cancelRecording}
              >
                <Icon name="close" width={16} height={16} />
              </button>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="btn-ghost p-2.5"
                aria-label={dict.multimodal.attachImage}
                title={dict.multimodal.attachImage}
              >
                <Icon name="image" width={18} height={18} />
              </button>
              <button
                type="button"
                onClick={startRecording}
                className="btn-ghost p-2.5"
                aria-label={dict.multimodal.record}
                title={dict.multimodal.record}
              >
                <Icon name="mic" width={18} height={18} />
              </button>
            </>
          )}
          <textarea
            ref={ref}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            placeholder={recording ? dict.multimodal.recording : dict.chat.inputPlaceholder}
            disabled={recording}
            className="scroll-slim max-h-52 flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] text-ink placeholder:text-ink-faint focus:outline-none disabled:opacity-70"
            aria-label={dict.chat.inputPlaceholder}
          />
          {busy ? (
            <button onClick={onStop} className="btn-outline p-2.5" aria-label={dict.chat.stop} title={dict.chat.stop}>
              <Icon name="stop" width={18} height={18} />
            </button>
          ) : (
            <button
              onClick={onSend}
              disabled={!input.trim() && attachments.length === 0}
              className="btn-primary p-2.5"
              aria-label={dict.chat.send}
              title={dict.chat.send}
            >
              <Icon name="send" width={18} height={18} />
            </button>
          )}
        </div>
        <p className="mt-1.5 text-center text-[11px] text-ink-faint">{dict.chat.devProviderNote}</p>
      </div>
    </div>
  );
}

function AttachmentChip({
  attachment,
  dict,
  onRemove,
  onRunOcr,
}: {
  attachment: Attachment;
  dict: Dictionary;
  onRemove: () => void;
  onRunOcr: () => void;
}) {
  const isImage = attachment.mediaType === 'IMAGE';
  return (
    <div className="rounded-xl border border-line bg-paper-sunken p-2">
      <div className="flex items-start gap-2">
        {isImage ? (
          // Private, access-checked bytes — only ever the /api/media/[id] route.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/media/${attachment.id}`}
            alt={dict.multimodal.imageAlt}
            className="h-14 w-14 rounded-lg border border-line object-cover"
          />
        ) : (
          <span className="grid h-14 w-14 place-items-center rounded-lg border border-line bg-paper text-ink-soft">
            <Icon name="mic" width={20} height={20} />
          </span>
        )}
        <div className="min-w-0">
          <p className="text-xs font-medium text-ink">
            {isImage ? dict.multimodal.imageAlt : dict.multimodal.voiceNote}
          </p>
          {!isImage && <audio controls src={`/api/media/${attachment.id}`} className="mt-1 h-8 max-w-[200px]" />}
          <div className="mt-1 flex items-center gap-2">
            {isImage && (
              <button
                type="button"
                onClick={onRunOcr}
                disabled={attachment.ocrBusy}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-accent hover:underline disabled:opacity-60"
              >
                <Icon name="scan" width={12} height={12} />
                {attachment.ocrBusy ? dict.multimodal.extracting : dict.multimodal.extractText}
              </button>
            )}
            <button
              type="button"
              onClick={onRemove}
              aria-label={dict.multimodal.removeAttachment}
              className="inline-flex items-center gap-1 text-[11px] text-ink-soft hover:text-danger"
            >
              <Icon name="close" width={12} height={12} />
              {dict.multimodal.removeAttachment}
            </button>
          </div>
        </div>
      </div>
      {attachment.ocrOpen && (attachment.ocrText !== undefined || attachment.ocrError) && (
        <div className="mt-2">
          {attachment.ocrError ? (
            <p className="text-[11px] text-danger">{attachment.ocrError}</p>
          ) : attachment.ocrText ? (
            <p
              dir="auto"
              className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded-lg border border-line bg-paper px-2 py-1.5 text-start text-xs text-ink-soft"
            >
              {attachment.ocrText}
            </p>
          ) : (
            <p className="text-[11px] text-ink-faint">{dict.multimodal.ocrEmpty}</p>
          )}
        </div>
      )}
    </div>
  );
}
