'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { Icon } from '@/components/Icon';
import { PersonaHome } from '@/components/app/PersonaHome';

// ---- Types (mirror the API shapes; UI-only) ----

type ItemType =
  | 'PROMPT_TEMPLATE'
  | 'AGENT_TEMPLATE'
  | 'WORKFLOW_TEMPLATE'
  | 'RESEARCH_TEMPLATE'
  | 'KNOWLEDGE_TEMPLATE';

type RiskLevel = 'CONTENT_ONLY' | 'READ_ONLY' | 'WRITE_CAPABLE' | 'SCHEDULED_WRITE' | 'HIGH_RISK';

interface LibraryCard {
  id: string;
  slug: string;
  itemType: string;
  title: string;
  titleAr: string | null;
  shortDescription: string;
  shortDescriptionAr?: string | null;
  riskLevel: string;
  verified: boolean;
  featured: boolean;
  installationCount: number;
  publisherType?: string;
  reason?: string;
}

interface DiscoverData {
  persona: string;
  featured: LibraryCard[];
  forYou: LibraryCard[];
  sections: Array<{ key: string; items: LibraryCard[] }>;
}

interface CategoryDef {
  slug: string;
  labelEn: string;
  labelAr: string;
  personaScopes: string[];
}

interface ExperienceChoice {
  id: string;
  slug: string;
  label: { en: string; ar: string };
}

interface Disclosure {
  itemType: string;
  riskLevel: string;
  requiredTools: string[];
  requiredConnectors: string[];
  connectedConnectors: string[];
  missingConnectors: string[];
  requiredCapabilities: string[];
  requiredPlans: string[];
  externalWrites: string[];
  dataMovement: Array<{ from: string; to: string }>;
  startsAsDraft: boolean;
  canActivate: boolean;
  blockers: string[];
}

interface ItemDetail {
  item: {
    id: string;
    slug: string;
    itemType: string;
    title: string;
    titleAr: string | null;
    shortDescription: string;
    shortDescriptionAr: string | null;
    longDescription: string | null;
    longDescriptionAr: string | null;
    visibility: string;
    status: string;
    riskLevel: string;
    verified: boolean;
    featured: boolean;
    categories: string[];
    tags: string[];
    supportedPersonas: string[];
    requiredPlans: string[];
    requiredConnectors: string[];
    requiredTools: string[];
    requiredCapabilities: string[];
    publisherType: string;
    installationCount: number;
  };
  version: { id: string; version: number; changeNotes: string | null; configHash: string | null } | null;
  disclosure: Disclosure | null;
  canManage: boolean;
  versions?: Array<{ id: string; version: number; status: string; riskLevel: string; createdAt: string }>;
}

interface Installation {
  id: string;
  libraryItemId: string;
  versionId: string;
  installedDefinitionType: string;
  installedDefinitionId: string | null;
  status: string;
  pinnedVersion: number | null;
  installedAt: string;
}

interface UpdatePreview {
  securitySensitive: boolean;
  newTools: string[];
  newConnectors: string[];
  riskIncreased: boolean;
  approvalPolicyChanged: boolean;
}

type View = { kind: 'hub' } | { kind: 'detail'; id: string };
type Tab = 'discover' | 'browse' | 'installed';

// ---- Label + colour helpers ----

function itemTypeLabel(type: string, dict: Dictionary): string {
  const map: Record<string, string> = {
    PROMPT_TEMPLATE: dict.library.typePrompt,
    AGENT_TEMPLATE: dict.library.typeAgent,
    WORKFLOW_TEMPLATE: dict.library.typeWorkflow,
    RESEARCH_TEMPLATE: dict.library.typeResearch,
    KNOWLEDGE_TEMPLATE: dict.library.typeKnowledge,
  };
  return map[type] ?? dict.library.typeOther;
}

function riskLabel(risk: string, dict: Dictionary): string {
  const map: Record<string, string> = {
    CONTENT_ONLY: dict.library.riskContentOnly,
    READ_ONLY: dict.library.riskReadOnly,
    WRITE_CAPABLE: dict.library.riskWriteCapable,
    SCHEDULED_WRITE: dict.library.riskScheduledWrite,
    HIGH_RISK: dict.library.riskHigh,
  };
  return map[risk] ?? dict.library.riskOther;
}

function riskClass(risk: string): string {
  switch (risk) {
    case 'CONTENT_ONLY':
      return 'bg-success/15 text-success';
    case 'READ_ONLY':
      return 'bg-accent-soft text-accent';
    case 'WRITE_CAPABLE':
      return 'bg-gold/15 text-gold';
    case 'SCHEDULED_WRITE':
    case 'HIGH_RISK':
      return 'bg-danger/10 text-danger';
    default:
      return 'bg-paper-sunken text-ink-soft';
  }
}

function publisherLabel(type: string | undefined, dict: Dictionary): string | null {
  if (type === 'BIINA') return dict.library.byBiina;
  if (type === 'ORGANIZATION') return dict.library.byOrg;
  if (type === 'USER') return dict.library.byUser;
  return null;
}

function defTypeLabel(type: string, dict: Dictionary): string {
  const map: Record<string, string> = {
    AGENT: dict.library.defAgent,
    WORKFLOW: dict.library.defWorkflow,
    PROMPT: dict.library.defPrompt,
    RESEARCH: dict.library.defResearch,
    KNOWLEDGE: dict.library.defKnowledge,
  };
  return map[type] ?? type;
}

function installStatusLabel(status: string, dict: Dictionary): string {
  const map: Record<string, string> = {
    DRAFT: dict.library.statusDraft,
    ACTIVE: dict.library.statusActive,
    DISABLED: dict.library.statusDisabled,
    SUSPENDED: dict.library.statusSuspended,
  };
  return map[status] ?? status;
}

function installStatusClass(status: string): string {
  switch (status) {
    case 'ACTIVE':
      return 'bg-success/15 text-success';
    case 'DRAFT':
      return 'bg-accent-soft text-accent';
    case 'SUSPENDED':
      return 'bg-danger/10 text-danger';
    default:
      return 'bg-paper-sunken text-ink-soft';
  }
}

function cardTitle(c: { title: string; titleAr: string | null }, locale: Locale): string {
  return locale === 'ar' && c.titleAr ? c.titleAr : c.title;
}

function cardDesc(
  c: { shortDescription: string; shortDescriptionAr?: string | null },
  locale: Locale,
): string {
  return locale === 'ar' && c.shortDescriptionAr ? c.shortDescriptionAr : c.shortDescription;
}

// ---- Root ----

export function LibraryPanel({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const [view, setView] = useState<View>({ kind: 'hub' });

  return (
    <div className="scroll-slim h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-5 py-8">
        {view.kind === 'hub' && (
          <Hub locale={locale} dict={dict} onOpen={(id) => setView({ kind: 'detail', id })} />
        )}
        {view.kind === 'detail' && (
          <Detail locale={locale} dict={dict} id={view.id} onBack={() => setView({ kind: 'hub' })} />
        )}
      </div>
    </div>
  );
}

function Loading() {
  return (
    <div className="grid place-items-center py-10">
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-line-strong border-t-accent" />
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
        active ? 'border-accent text-accent' : 'border-transparent text-ink-soft hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}

// ---- Item card ----

function ItemCard({
  card,
  locale,
  dict,
  onOpen,
}: {
  card: LibraryCard;
  locale: Locale;
  dict: Dictionary;
  onOpen: () => void;
}) {
  const num = new Intl.NumberFormat(locale === 'ar' ? 'ar-AE' : 'en-US');
  const publisher = publisherLabel(card.publisherType, dict);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="card flex w-full flex-col items-start p-4 text-start transition-colors hover:border-accent"
    >
      <div className="flex w-full items-start justify-between gap-2">
        <span className="min-w-0 font-semibold text-ink" dir="auto">
          {cardTitle(card, locale)}
        </span>
        {card.verified && (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success">
            <Icon name="check" width={11} height={11} />
            {dict.library.verified}
          </span>
        )}
      </div>
      {cardDesc(card, locale) && (
        <span className="mt-1 line-clamp-2 text-sm text-ink-soft" dir="auto">
          {cardDesc(card, locale)}
        </span>
      )}
      {card.reason && (
        <span className="mt-2 inline-block rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent" dir="auto">
          {card.reason}
        </span>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="rounded-full bg-paper-sunken px-2 py-0.5 text-[11px] font-medium text-ink-soft">
          {itemTypeLabel(card.itemType, dict)}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${riskClass(card.riskLevel)}`}>
          {riskLabel(card.riskLevel, dict)}
        </span>
        {card.featured && (
          <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[11px] font-medium text-gold">
            {dict.library.featuredBadge}
          </span>
        )}
        <span className="ms-auto text-[11px] text-ink-faint">
          {num.format(card.installationCount)} {dict.library.installs}
        </span>
      </div>
      {publisher && <span className="mt-1.5 text-[11px] text-ink-faint">{publisher}</span>}
    </button>
  );
}

// ---- Hub ----

function Hub({
  locale,
  dict,
  onOpen,
}: {
  locale: Locale;
  dict: Dictionary;
  onOpen: (id: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('discover');
  const [categories, setCategories] = useState<CategoryDef[]>([]);
  const [personas, setPersonas] = useState<ExperienceChoice[]>([]);

  const loadCategories = useCallback(async () => {
    try {
      const res = await fetch('/api/library/categories', { cache: 'no-store' });
      if (!res.ok) return;
      const body = await res.json();
      setCategories(Array.isArray(body.categories) ? body.categories : []);
    } catch {
      /* non-fatal */
    }
  }, []);

  const loadPersonas = useCallback(async () => {
    try {
      const res = await fetch('/api/experience', { cache: 'no-store' });
      if (!res.ok) return;
      const body = await res.json();
      setPersonas(Array.isArray(body.choices) ? body.choices : []);
    } catch {
      /* non-fatal */
    }
  }, []);

  useEffect(() => {
    void loadCategories();
    void loadPersonas();
  }, [loadCategories, loadPersonas]);

  const categoryLabel = useCallback(
    (slug: string) => {
      const c = categories.find((x) => x.slug === slug);
      if (!c) return slug;
      return locale === 'ar' ? c.labelAr : c.labelEn;
    },
    [categories, locale],
  );

  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight text-ink">{dict.library.title}</h1>
      <p className="mt-1 text-sm text-ink-soft">{dict.library.subtitle}</p>

      <div className="mt-6 flex gap-1 border-b border-line">
        <TabButton active={tab === 'discover'} onClick={() => setTab('discover')}>
          {dict.library.tabDiscover}
        </TabButton>
        <TabButton active={tab === 'browse'} onClick={() => setTab('browse')}>
          {dict.library.tabBrowse}
        </TabButton>
        <TabButton active={tab === 'installed'} onClick={() => setTab('installed')}>
          {dict.library.tabInstalled}
        </TabButton>
      </div>

      {tab === 'discover' && (
        <DiscoverTab locale={locale} dict={dict} onOpen={onOpen} categoryLabel={categoryLabel} />
      )}
      {tab === 'browse' && (
        <BrowseTab locale={locale} dict={dict} onOpen={onOpen} categories={categories} personas={personas} />
      )}
      {tab === 'installed' && <InstalledTab locale={locale} dict={dict} onOpen={onOpen} />}
    </>
  );
}

// ---- Discover tab ----

function DiscoverTab({
  locale,
  dict,
  onOpen,
  categoryLabel,
}: {
  locale: Locale;
  dict: Dictionary;
  onOpen: (id: string) => void;
  categoryLabel: (slug: string) => string;
}) {
  const [data, setData] = useState<DiscoverData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/library/discover?locale=${locale}`, { cache: 'no-store' });
        if (res.status === 403) {
          if (alive) setError(dict.library.unavailable);
          return;
        }
        if (!res.ok) throw new Error();
        const body = await res.json();
        if (alive) setData(body);
      } catch {
        if (alive) setError(dict.common.somethingWrong);
      }
    })();
    return () => {
      alive = false;
    };
  }, [locale, dict]);

  if (error) {
    return <p className="mt-6 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>;
  }
  if (!data) return <Loading />;

  const empty = data.featured.length === 0 && data.forYou.length === 0 && data.sections.length === 0;
  if (empty) {
    return <p className="mt-6 text-sm text-ink-faint">{dict.library.empty}</p>;
  }

  return (
    <div className="mt-4 space-y-8">
      <PersonaHome locale={locale} dict={dict} />
      {data.featured.length > 0 && (
        <Section title={dict.library.featured}>
          <CardGrid>
            {data.featured.map((c) => (
              <ItemCard key={c.id} card={c} locale={locale} dict={dict} onOpen={() => onOpen(c.id)} />
            ))}
          </CardGrid>
        </Section>
      )}
      {data.forYou.length > 0 && (
        <Section title={dict.library.forYou}>
          <CardGrid>
            {data.forYou.map((c) => (
              <ItemCard key={c.id} card={c} locale={locale} dict={dict} onOpen={() => onOpen(c.id)} />
            ))}
          </CardGrid>
        </Section>
      )}
      {data.sections.map((s) => (
        <Section key={s.key} title={categoryLabel(s.key)}>
          <CardGrid>
            {s.items.map((c) => (
              <ItemCard key={c.id} card={c} locale={locale} dict={dict} onOpen={() => onOpen(c.id)} />
            ))}
          </CardGrid>
        </Section>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-sm font-semibold text-ink-soft" dir="auto">
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function CardGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2">{children}</div>;
}

// ---- Browse tab (search + filters) ----

function BrowseTab({
  locale,
  dict,
  onOpen,
  categories,
  personas,
}: {
  locale: Locale;
  dict: Dictionary;
  onOpen: (id: string) => void;
  categories: CategoryDef[];
  personas: ExperienceChoice[];
}) {
  const [q, setQ] = useState('');
  const [itemType, setItemType] = useState('');
  const [persona, setPersona] = useState('');
  const [category, setCategory] = useState('');
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [readOnlyOnly, setReadOnlyOnly] = useState(false);
  const [freePlanOnly, setFreePlanOnly] = useState(false);

  const [items, setItems] = useState<LibraryCard[] | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (targetPage: number, append: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const p = new URLSearchParams();
        if (q.trim()) p.set('q', q.trim());
        if (itemType) p.set('itemType', itemType);
        if (persona) p.set('persona', persona);
        if (category) p.set('category', category);
        if (verifiedOnly) p.set('verifiedOnly', 'true');
        if (readOnlyOnly) p.set('readOnlyOnly', 'true');
        if (freePlanOnly) p.set('freePlanOnly', 'true');
        p.set('page', String(targetPage));
        const res = await fetch(`/api/library?${p.toString()}`, { cache: 'no-store' });
        if (res.status === 403) {
          setError(dict.library.unavailable);
          setItems([]);
          return;
        }
        if (!res.ok) throw new Error();
        const body = await res.json();
        const rows: LibraryCard[] = Array.isArray(body.items) ? body.items : [];
        setItems((prev) => (append && prev ? [...prev, ...rows] : rows));
        setHasMore(Boolean(body.hasMore));
        setPage(targetPage);
      } catch {
        setError(dict.common.somethingWrong);
        if (!append) setItems([]);
      } finally {
        setLoading(false);
      }
    },
    [q, itemType, persona, category, verifiedOnly, readOnlyOnly, freePlanOnly, dict],
  );

  // Reload when filters (not the free-text box) change.
  useEffect(() => {
    void load(1, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemType, persona, category, verifiedOnly, readOnlyOnly, freePlanOnly]);

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    void load(1, false);
  }

  function clearFilters() {
    setItemType('');
    setPersona('');
    setCategory('');
    setVerifiedOnly(false);
    setReadOnlyOnly(false);
    setFreePlanOnly(false);
  }

  const typeOptions: ItemType[] = [
    'PROMPT_TEMPLATE',
    'AGENT_TEMPLATE',
    'WORKFLOW_TEMPLATE',
    'RESEARCH_TEMPLATE',
    'KNOWLEDGE_TEMPLATE',
  ];

  return (
    <div className="mt-4">
      <form onSubmit={submitSearch} className="flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={dict.library.searchPlaceholder}
          dir="auto"
          className="w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-accent"
        />
        <button type="submit" className="btn-primary gap-1.5 px-4 py-2 text-sm">
          <Icon name="search" width={16} height={16} />
          {dict.library.search}
        </button>
      </form>

      {/* Filters */}
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <Select value={itemType} onChange={setItemType} ariaLabel={dict.library.filterType}>
          <option value="">{dict.library.allTypes}</option>
          {typeOptions.map((t) => (
            <option key={t} value={t}>
              {itemTypeLabel(t, dict)}
            </option>
          ))}
        </Select>
        <Select value={persona} onChange={setPersona} ariaLabel={dict.library.filterPersona}>
          <option value="">{dict.library.allPersonas}</option>
          {personas.map((p) => (
            <option key={p.id} value={p.slug}>
              {locale === 'ar' ? p.label.ar : p.label.en}
            </option>
          ))}
        </Select>
        <Select value={category} onChange={setCategory} ariaLabel={dict.library.filterCategory}>
          <option value="">{dict.library.allCategories}</option>
          {categories.map((c) => (
            <option key={c.slug} value={c.slug}>
              {locale === 'ar' ? c.labelAr : c.labelEn}
            </option>
          ))}
        </Select>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Toggle active={verifiedOnly} onClick={() => setVerifiedOnly((v) => !v)}>
          {dict.library.verifiedOnly}
        </Toggle>
        <Toggle active={readOnlyOnly} onClick={() => setReadOnlyOnly((v) => !v)}>
          {dict.library.readOnlyOnly}
        </Toggle>
        <Toggle active={freePlanOnly} onClick={() => setFreePlanOnly((v) => !v)}>
          {dict.library.freePlanOnly}
        </Toggle>
        {(itemType || persona || category || verifiedOnly || readOnlyOnly || freePlanOnly) && (
          <button type="button" onClick={clearFilters} className="btn-ghost px-2.5 py-1 text-xs">
            {dict.library.clearFilters}
          </button>
        )}
      </div>

      {error && <p className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

      <div className="mt-4">
        {items === null ? (
          <Loading />
        ) : items.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-ink-faint">
            {dict.library.noResults}
          </p>
        ) : (
          <>
            <CardGrid>
              {items.map((c) => (
                <ItemCard key={c.id} card={c} locale={locale} dict={dict} onOpen={() => onOpen(c.id)} />
              ))}
            </CardGrid>
            {hasMore && (
              <div className="mt-4 grid place-items-center">
                <button
                  type="button"
                  onClick={() => load(page + 1, true)}
                  disabled={loading}
                  className="btn-ghost px-4 py-2 text-sm"
                >
                  {loading ? dict.common.loading : dict.library.loadMore}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Select({
  value,
  onChange,
  ariaLabel,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={ariaLabel}
      className="w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-accent"
    >
      {children}
    </select>
  );
}

function Toggle({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        active ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-soft hover:border-line-strong'
      }`}
    >
      {children}
    </button>
  );
}

// ---- Installed tab ----

function InstalledTab({
  locale,
  dict,
  onOpen,
}: {
  locale: Locale;
  dict: Dictionary;
  onOpen: (id: string) => void;
}) {
  const [installations, setInstallations] = useState<Installation[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/library/installations', { cache: 'no-store' });
      if (!res.ok) throw new Error();
      const body = await res.json();
      setInstallations(Array.isArray(body.installations) ? body.installations : []);
    } catch {
      setError(dict.common.somethingWrong);
      setInstallations([]);
    }
  }, [dict]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <p className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>;
  if (installations === null) return <Loading />;

  const visible = installations.filter((i) => i.status !== 'UNINSTALLED');

  return (
    <div className="mt-4">
      <p className="text-xs text-ink-faint">{dict.library.uninstallNote}</p>
      {visible.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-ink-faint">
          {dict.library.installedEmpty}
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {visible.map((inst) => (
            <InstalledRow key={inst.id} inst={inst} locale={locale} dict={dict} onOpen={onOpen} onChanged={load} />
          ))}
        </ul>
      )}
    </div>
  );
}

function InstalledRow({
  inst,
  locale,
  dict,
  onOpen,
  onChanged,
}: {
  inst: Installation;
  locale: Locale;
  dict: Dictionary;
  onOpen: (id: string) => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(false);
  const [preview, setPreview] = useState<UpdatePreview | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const fmtDate = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-US', { dateStyle: 'medium' });

  async function checkUpdate() {
    setBusy(true);
    setError(null);
    setBanner(null);
    try {
      const res = await fetch(`/api/library/installations/${inst.id}`, { cache: 'no-store' });
      if (!res.ok) throw new Error();
      const body = await res.json();
      setChecked(true);
      setPreview(body.update ?? null);
      if (!body.update) setBanner(dict.library.upToDate);
    } catch {
      setError(dict.common.somethingWrong);
    } finally {
      setBusy(false);
    }
  }

  async function applyUpdate(confirm: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/library/installations/${inst.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm }),
      });
      const body = await res.json().catch(() => null);
      if (res.status === 409 && body?.code === 'update_requires_review') {
        setPreview((body.data?.preview as UpdatePreview) ?? preview);
        setConfirming(true);
        return;
      }
      if (!res.ok) {
        setError((body && body.error) || dict.common.somethingWrong);
        return;
      }
      setBanner(dict.library.updateApplied);
      setPreview(null);
      setConfirming(false);
      setChecked(false);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function uninstall() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/library/installations/${inst.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      onChanged();
    } catch {
      setError(dict.common.somethingWrong);
    } finally {
      setBusy(false);
    }
  }

  const securitySensitive = preview?.securitySensitive || confirming;

  return (
    <li className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <button type="button" onClick={() => onOpen(inst.libraryItemId)} className="min-w-0 text-start">
          <span className="flex items-center gap-2">
            <span className="rounded-full bg-paper-sunken px-2 py-0.5 text-[11px] font-medium text-ink-soft">
              {defTypeLabel(inst.installedDefinitionType, dict)}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${installStatusClass(inst.status)}`}>
              {installStatusLabel(inst.status, dict)}
            </span>
          </span>
          <span className="mt-1.5 block text-xs text-ink-faint">
            {dict.library.installedOn}: {fmtDate.format(new Date(inst.installedAt))}
            {inst.pinnedVersion != null ? ` · ${dict.library.pinned} ${inst.pinnedVersion}` : ''}
          </span>
        </button>
      </div>

      {banner && <p className="mt-3 rounded-lg bg-success/15 px-3 py-2 text-xs text-success">{banner}</p>}
      {error && <p className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}

      {/* Update review dialog */}
      {(preview || confirming) && securitySensitive && (
        <div className="mt-3 rounded-xl border border-gold/40 bg-gold/5 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Icon name="shield" width={16} height={16} />
            {dict.library.updateReviewTitle}
          </h3>
          <p className="mt-1 text-xs text-ink-soft">{dict.library.updateReviewIntro}</p>
          <dl className="mt-3 space-y-1.5 text-xs">
            {preview?.newTools && preview.newTools.length > 0 && (
              <ChipRow label={dict.library.newTools} values={preview.newTools} />
            )}
            {preview?.newConnectors && preview.newConnectors.length > 0 && (
              <ChipRow label={dict.library.newConnectors} values={preview.newConnectors} />
            )}
            {preview?.riskIncreased && (
              <p className="font-medium text-danger">{dict.library.riskIncreased}</p>
            )}
            {preview?.approvalPolicyChanged && (
              <p className="font-medium text-gold">{dict.library.approvalChanged}</p>
            )}
          </dl>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button onClick={() => applyUpdate(true)} disabled={busy} className="btn-primary px-3 py-1.5 text-xs">
              {busy ? dict.library.checking : dict.library.confirmApply}
            </button>
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {!checked ? (
          <button onClick={checkUpdate} disabled={busy} className="btn-ghost px-2.5 py-1 text-xs">
            {busy ? dict.library.checking : dict.library.update}
          </button>
        ) : preview && !securitySensitive ? (
          <button onClick={() => applyUpdate(false)} disabled={busy} className="btn-primary px-2.5 py-1 text-xs">
            {busy ? dict.library.checking : dict.library.applyUpdate}
          </button>
        ) : null}
        {checked && preview && (
          <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
            {dict.library.updateAvailable}
          </span>
        )}
        <button onClick={uninstall} disabled={busy} className="btn-ghost px-2.5 py-1 text-xs text-danger">
          {busy ? dict.library.uninstalling : dict.library.uninstall}
        </button>
      </div>
    </li>
  );
}

function ChipRow({ label, values }: { label: string; values: string[] }) {
  return (
    <div>
      <dt className="text-ink-faint">{label}</dt>
      <dd className="mt-1 flex flex-wrap gap-1.5">
        {values.map((v) => (
          <code key={v} className="rounded bg-paper-sunken px-1.5 py-0.5 text-[11px] text-ink-soft" dir="ltr">
            {v}
          </code>
        ))}
      </dd>
    </div>
  );
}

// ---- Detail ----

function BackHeader({ onBack, backLabel }: { onBack: () => void; backLabel: string }) {
  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={onBack} className="btn-ghost -ms-2 gap-1 p-2 text-sm">
        <span className="ltr:inline rtl:hidden">&larr;</span>
        <span className="ltr:hidden rtl:inline">&rarr;</span>
        {backLabel}
      </button>
    </div>
  );
}

function Detail({
  locale,
  dict,
  id,
  onBack,
}: {
  locale: Locale;
  dict: Dictionary;
  id: string;
  onBack: () => void;
}) {
  const [data, setData] = useState<ItemDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  const num = new Intl.NumberFormat(locale === 'ar' ? 'ar-AE' : 'en-US');
  const fmtDate = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-US', { dateStyle: 'medium' });

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/library/${id}`, { cache: 'no-store' });
      if (res.status === 404) {
        setError(dict.library.noResults);
        return;
      }
      if (!res.ok) throw new Error();
      setData(await res.json());
    } catch {
      setError(dict.common.somethingWrong);
    }
  }, [id, dict]);

  useEffect(() => {
    void load();
  }, [load]);

  async function install() {
    setBusy(true);
    setError(null);
    setBanner(null);
    try {
      const res = await fetch(`/api/library/${id}/install`, { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (res.status === 403) {
        setError(dict.library.unavailable);
        return;
      }
      if (!res.ok || !body) {
        setError((body && body.error) || dict.common.somethingWrong);
        return;
      }
      setBanner(body.status === 'DRAFT' ? dict.library.installSuccessDraft : dict.library.installSuccess);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function fork() {
    setBusy(true);
    setError(null);
    setBanner(null);
    try {
      const res = await fetch(`/api/library/${id}/fork`, { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (res.status === 403) {
        setError(dict.library.unavailable);
        return;
      }
      if (!res.ok || !body) {
        setError((body && body.error) || dict.common.somethingWrong);
        return;
      }
      setBanner(dict.library.forkSuccess);
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return (
      <>
        <BackHeader onBack={onBack} backLabel={dict.library.back} />
        {error ? <p className="mt-6 text-sm text-danger">{error}</p> : <Loading />}
      </>
    );
  }

  const { item, version, disclosure, canManage, versions } = data;
  const title = locale === 'ar' && item.titleAr ? item.titleAr : item.title;
  const longDesc = locale === 'ar' && item.longDescriptionAr ? item.longDescriptionAr : item.longDescription;
  const shortDesc = locale === 'ar' && item.shortDescriptionAr ? item.shortDescriptionAr : item.shortDescription;
  const publisher = publisherLabel(item.publisherType, dict);
  const dis = disclosure;

  const hasRequirements =
    dis &&
    (dis.requiredConnectors.length > 0 ||
      dis.requiredCapabilities.length > 0 ||
      dis.requiredPlans.length > 0 ||
      dis.requiredTools.length > 0);

  return (
    <>
      <BackHeader onBack={onBack} backLabel={dict.library.back} />

      <div className="mt-4 flex flex-wrap items-start justify-between gap-2">
        <h1 className="min-w-0 text-2xl font-bold tracking-tight text-ink" dir="auto">
          {title}
        </h1>
        {item.verified && (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-success/15 px-2.5 py-0.5 text-xs font-medium text-success">
            <Icon name="check" width={12} height={12} />
            {dict.library.verified}
          </span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="rounded-full bg-paper-sunken px-2 py-0.5 text-[11px] font-medium text-ink-soft">
          {itemTypeLabel(item.itemType, dict)}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${riskClass(item.riskLevel)}`}>
          {riskLabel(item.riskLevel, dict)}
        </span>
        {publisher && <span className="text-[11px] text-ink-faint">· {publisher}</span>}
        <span className="text-[11px] text-ink-faint">
          · {num.format(item.installationCount)} {dict.library.installs}
        </span>
      </div>

      {banner && <p className="mt-4 rounded-lg bg-success/15 px-3 py-2 text-sm text-success">{banner}</p>}
      {error && <p className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

      {/* Overview */}
      {(longDesc || shortDesc) && (
        <section className="card mt-6 p-5">
          <h2 className="text-sm font-semibold text-ink">{dict.library.overview}</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-ink-soft" dir="auto">
            {longDesc || shortDesc}
          </p>
        </section>
      )}

      {/* Disclosure / install preview */}
      {dis && (
        <section className="card mt-4 p-5">
          <h2 className="text-sm font-semibold text-ink">{dict.library.requirements}</h2>

          {hasRequirements ? (
            <dl className="mt-3 space-y-2 text-xs">
              {dis.requiredConnectors.length > 0 && (
                <ChipRow label={dict.library.connectorsLabel} values={dis.requiredConnectors} />
              )}
              {dis.requiredCapabilities.length > 0 && (
                <ChipRow label={dict.library.capabilitiesLabel} values={dis.requiredCapabilities} />
              )}
              {dis.requiredPlans.length > 0 && <ChipRow label={dict.library.planLabel} values={dis.requiredPlans} />}
              {dis.requiredTools.length > 0 && <ChipRow label={dict.library.toolsLabel} values={dis.requiredTools} />}
            </dl>
          ) : (
            <p className="mt-2 text-sm text-ink-soft">{dict.library.requiresNothing}</p>
          )}

          {/* External writes */}
          <div className="mt-4 grid gap-2 text-xs sm:grid-cols-2">
            <div className="rounded-xl border border-line px-3 py-2">
              <dt className="text-ink-faint">{dict.library.externalWrites}</dt>
              <dd className="mt-0.5 font-medium text-ink" dir="ltr">
                {dis.externalWrites.length > 0 ? dis.externalWrites.join(', ') : dict.library.none}
              </dd>
            </div>
            <div className="rounded-xl border border-line px-3 py-2">
              <dt className="text-ink-faint">{dict.library.riskLevelLabel}</dt>
              <dd className="mt-0.5 font-medium text-ink">{riskLabel(dis.riskLevel, dict)}</dd>
            </div>
          </div>

          {/* Data movement */}
          {dis.dataMovement.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-semibold text-ink-soft">{dict.library.dataMovement}</p>
              <ul className="mt-1.5 space-y-1">
                {dis.dataMovement.map((m, i) => (
                  <li key={i} className="flex items-center gap-2 text-xs text-ink-soft" dir="ltr">
                    <code className="rounded bg-paper-sunken px-1.5 py-0.5">{m.from}</code>
                    <span className="text-ink-faint">→</span>
                    <code className="rounded bg-paper-sunken px-1.5 py-0.5">{m.to}</code>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Missing connectors */}
          {dis.missingConnectors.length > 0 && (
            <div className="mt-4 rounded-xl border border-gold/40 bg-gold/5 p-3">
              <p className="text-xs font-semibold text-gold">{dict.library.missingConnectors}</p>
              <p className="mt-1 text-[11px] text-ink-soft">{dict.library.missingConnectorsHint}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {dis.missingConnectors.map((c) => (
                  <code key={c} className="rounded bg-paper-sunken px-1.5 py-0.5 text-[11px] text-ink-soft" dir="ltr">
                    {c}
                  </code>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Install / fork */}
      <section className="card mt-4 p-5">
        <h2 className="text-sm font-semibold text-ink">{dict.library.whatInstalls}</h2>
        <p className="mt-2 text-sm text-ink-soft">{dict.library.installNote}</p>
        {dis?.startsAsDraft && (
          <p className="mt-2 rounded-lg bg-accent-soft px-3 py-2 text-xs text-accent">{dict.library.installedAsDraft}</p>
        )}
        {dis && !dis.canActivate && (
          <p className="mt-2 rounded-lg bg-gold/15 px-3 py-2 text-xs text-gold">{dict.library.cannotActivate}</p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button onClick={install} disabled={busy || !version} className="btn-primary gap-1.5 px-4 py-2 text-sm">
            <Icon name="plus" width={16} height={16} />
            {busy ? dict.library.installing : dict.library.install}
          </button>
          <button onClick={fork} disabled={busy} className="btn-ghost gap-1.5 px-3 py-2 text-sm">
            <Icon name="copy" width={16} height={16} />
            {busy ? dict.library.forking : dict.library.fork}
          </button>
        </div>
        <p className="mt-2 text-xs text-ink-faint">{dict.library.activationNote}</p>
        <p className="mt-1 text-xs text-ink-faint">{dict.library.forkNote}</p>
      </section>

      {/* Versions (manage) */}
      {canManage && versions && versions.length > 0 && (
        <section className="card mt-4 p-5">
          <h2 className="text-sm font-semibold text-ink">{dict.library.versions}</h2>
          <ul className="mt-3 space-y-2">
            {versions.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-3 py-2 text-xs">
                <span className="font-medium text-ink">
                  {dict.library.version} {v.version}
                </span>
                <span className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 font-semibold ${riskClass(v.riskLevel)}`}>
                    {riskLabel(v.riskLevel, dict)}
                  </span>
                  <span className="text-ink-faint">{v.status}</span>
                  <span className="text-ink-faint">{fmtDate.format(new Date(v.createdAt))}</span>
                </span>
              </li>
            ))}
          </ul>
          {version?.changeNotes && (
            <div className="mt-3">
              <p className="text-xs font-semibold text-ink-soft">{dict.library.changeNotes}</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-ink-soft" dir="auto">
                {version.changeNotes}
              </p>
            </div>
          )}
        </section>
      )}
    </>
  );
}
