'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { Icon } from '@/components/Icon';
import { BrandMark } from '@/components/Logo';
import { KnowledgeSelector, type RagMode } from './KnowledgeSelector';
import { ConnectedSourcesSelector } from './ConnectedSourcesSelector';

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

  // Keep state in sync when navigating between conversations.
  useEffect(() => {
    setMessages(initialMessages);
    convIdRef.current = initialConversationId;
    setError(null);
  }, [initialConversationId, initialMessages]);

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

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    setError(null);
    lastUserRef.current = content;

    const userMsg: UiMessage = { id: tempId(), role: 'user', content };
    const assistantMsg: UiMessage = { id: tempId(), role: 'assistant', content: '', streaming: true };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput('');
    setBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;
    const hadConversation = Boolean(convIdRef.current);
    const useRag = knowledgeBaseIds.length > 0 && ragMode !== 'off';
    if (webSearch) setSearching(true);
    let citations: Citation[] | undefined;
    let webSearched = false;

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
              <MessageRow key={m.id} message={m} dict={dict} locale={locale} searching={searching} />
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
}: {
  message: UiMessage;
  dict: Dictionary;
  locale: Locale;
  searching: boolean;
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
          {!isUser && message.citations && message.citations.length > 0 && (
            <Citations citations={message.citations} dict={dict} locale={locale} />
          )}
          {!isUser && !message.streaming && message.content.length > 0 && (
            <MessageActions content={message.content} dict={dict} />
          )}
        </div>
      </div>
    </div>
  );
}

function MessageActions({ content, dict }: { content: string; dict: Dictionary }) {
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
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
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
        </div>
        <div className="flex items-end gap-2 rounded-2xl border border-line-strong bg-paper-raised p-2 focus-within:border-accent">
          <textarea
            ref={ref}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={dict.chat.inputPlaceholder}
            className="scroll-slim max-h-52 flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] text-ink placeholder:text-ink-faint focus:outline-none"
            aria-label={dict.chat.inputPlaceholder}
          />
          {busy ? (
            <button onClick={onStop} className="btn-outline p-2.5" aria-label={dict.chat.stop} title={dict.chat.stop}>
              <Icon name="stop" width={18} height={18} />
            </button>
          ) : (
            <button
              onClick={onSend}
              disabled={!input.trim()}
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
