'use client';

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { Icon } from '@/components/Icon';

// ---------------------------------------------------------------------------
// Shared UI primitives (match existing panel conventions)
// ---------------------------------------------------------------------------

type Tab =
  | 'identity'
  | 'domains'
  | 'provisioning'
  | 'roles'
  | 'policy'
  | 'data'
  | 'integrations'
  | 'audit'
  | 'security';

function Loading() {
  return (
    <div className="grid place-items-center py-10">
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-line-strong border-t-accent" />
    </div>
  );
}

/** Inline messaging for a section that could not load (403 / plan / error). */
function SectionNotice({ tone, children }: { tone: 'error' | 'muted'; children: ReactNode }) {
  const cls =
    tone === 'error'
      ? 'bg-danger/10 text-danger'
      : 'border border-dashed border-line text-ink-faint';
  return <p className={`mt-4 rounded-lg px-3 py-2 text-sm ${cls}`}>{children}</p>;
}

function noticeFor(status: number, dict: Dictionary): string {
  if (status === 403) return dict.enterprise.noPermission;
  return dict.enterprise.loadError;
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
        active ? 'border-accent text-accent' : 'border-transparent text-ink-soft hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  highRisk,
  riskLabel,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  highRisk?: boolean;
  riskLabel?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 rounded-xl border border-line px-3 py-2.5 text-start transition-colors hover:border-line-strong"
    >
      <span className="flex items-center gap-2 text-sm text-ink" dir="auto">
        {label}
        {highRisk && (
          <span className="rounded-full bg-danger/10 px-2 py-0.5 text-[10px] font-semibold text-danger">
            {riskLabel}
          </span>
        )}
      </span>
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
          checked ? 'bg-accent' : 'bg-line-strong'
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-paper transition-all ${
            checked ? 'end-0.5' : 'start-0.5'
          }`}
        />
      </span>
    </button>
  );
}

function StatusBadge({ status, dict }: { status: string; dict: Dictionary }) {
  const map: Record<string, { label: string; cls: string }> = {
    VERIFIED: { label: dict.enterprise.statusVerified, cls: 'bg-success/15 text-success' },
    PENDING: { label: dict.enterprise.statusPending, cls: 'bg-gold/15 text-gold' },
    FAILED: { label: dict.enterprise.statusFailed, cls: 'bg-danger/10 text-danger' },
  };
  const s = map[status] ?? { label: status, cls: 'bg-paper-sunken text-ink-soft' };
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${s.cls}`}>{s.label}</span>;
}

function Banner({ tone, children }: { tone: 'ok' | 'error'; children: ReactNode }) {
  const cls = tone === 'ok' ? 'bg-success/15 text-success' : 'bg-danger/10 text-danger';
  return <p className={`mt-3 rounded-lg px-3 py-2 text-sm ${cls}`}>{children}</p>;
}

function EnvRefNote({ dict }: { dict: Dictionary }) {
  return (
    <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-accent-soft px-3 py-2 text-xs text-accent">
      <Icon name="shield" width={14} height={14} className="mt-0.5 shrink-0" />
      <span>{dict.enterprise.envRefNote}</span>
    </p>
  );
}

/** Read-only key/value tile. */
function InfoTile({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl border border-line px-3 py-2">
      <p className="text-[11px] text-ink-faint">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-ink" dir="auto">
        {value}
      </p>
    </div>
  );
}

function labeledField(id: string, label: string, node: ReactNode, hint?: string) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm text-ink-soft">
        {label}
      </label>
      {node}
      {hint && <p className="mt-1 text-xs text-ink-faint">{hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REGIONS = ['UAE', 'EU', 'US', 'OTHER'] as const;
type Region = (typeof REGIONS)[number];

function regionLabel(r: string, dict: Dictionary): string {
  const map: Record<string, string> = {
    UAE: dict.enterprise.regionUae,
    EU: dict.enterprise.regionEu,
    US: dict.enterprise.regionUs,
    OTHER: dict.enterprise.regionOther,
  };
  return map[r] ?? r;
}

function csvToList(v: string): string[] {
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function listToCsv(v: unknown): string {
  return Array.isArray(v) ? v.join(', ') : '';
}

// ---------------------------------------------------------------------------
// Root panel
// ---------------------------------------------------------------------------

export function OrgAdministrationPanel({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const [tab, setTab] = useState<Tab>('identity');

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'identity', label: dict.enterprise.tabIdentity },
    { key: 'domains', label: dict.enterprise.tabDomains },
    { key: 'provisioning', label: dict.enterprise.tabProvisioning },
    { key: 'roles', label: dict.enterprise.tabRoles },
    { key: 'policy', label: dict.enterprise.tabPolicy },
    { key: 'data', label: dict.enterprise.tabData },
    { key: 'integrations', label: dict.enterprise.tabIntegrations },
    { key: 'audit', label: dict.enterprise.tabAudit },
    { key: 'security', label: dict.enterprise.tabSecurity },
  ];

  return (
    <div className="scroll-slim h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-5 py-8">
        <h1 className="text-2xl font-bold tracking-tight text-ink">{dict.enterprise.title}</h1>
        <p className="mt-1 text-sm text-ink-soft">{dict.enterprise.subtitle}</p>

        <div className="scroll-slim mt-6 flex gap-1 overflow-x-auto border-b border-line">
          {tabs.map((t) => (
            <TabButton key={t.key} active={tab === t.key} onClick={() => setTab(t.key)}>
              {t.label}
            </TabButton>
          ))}
        </div>

        <div className="mt-2">
          {tab === 'identity' && <IdentitySection dict={dict} />}
          {tab === 'domains' && <DomainsSection locale={locale} dict={dict} />}
          {tab === 'provisioning' && <ProvisioningSection locale={locale} dict={dict} />}
          {tab === 'roles' && <RolesSection dict={dict} />}
          {tab === 'policy' && <PolicySection dict={dict} />}
          {tab === 'data' && <DataSection dict={dict} />}
          {tab === 'integrations' && <IntegrationsSection locale={locale} dict={dict} />}
          {tab === 'audit' && <AuditSection locale={locale} dict={dict} />}
          {tab === 'security' && <SecuritySection dict={dict} />}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

interface IdentityProvider {
  id: string;
  type: string;
  displayName: string;
  enabled: boolean;
  issuer: string | null;
  enforceSSO: boolean;
  allowPasswordFallback: boolean;
  domainRestriction: string[] | null;
  spEntityId: string | null;
  acsUrl: string | null;
}

function IdentitySection({ dict }: { dict: Dictionary }) {
  const [providers, setProviders] = useState<IdentityProvider[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async () => {
    setNotice(null);
    try {
      const res = await fetch('/api/org/enterprise/identity', { cache: 'no-store' });
      if (!res.ok) {
        setNotice(noticeFor(res.status, dict));
        setProviders([]);
        return;
      }
      const body = await res.json();
      setProviders(Array.isArray(body.providers) ? body.providers : []);
    } catch {
      setNotice(dict.enterprise.loadError);
      setProviders([]);
    }
  }, [dict]);

  useEffect(() => {
    void load();
  }, [load]);

  if (providers === null) return <Loading />;

  return (
    <div className="mt-4">
      <h2 className="text-sm font-semibold text-ink">{dict.enterprise.identityTitle}</h2>
      <p className="mt-1 text-sm text-ink-soft">{dict.enterprise.identityDesc}</p>
      {notice && <SectionNotice tone="error">{notice}</SectionNotice>}

      {providers.length === 0 && !notice ? (
        <SectionNotice tone="muted">{dict.enterprise.identityEmpty}</SectionNotice>
      ) : (
        <ul className="mt-4 space-y-3">
          {providers.map((p) => (
            <li key={p.id} className="card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-ink" dir="auto">
                  {p.displayName}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="rounded-full bg-paper-sunken px-2 py-0.5 text-[11px] font-medium text-ink-soft">
                    {p.type}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      p.enabled ? 'bg-success/15 text-success' : 'bg-paper-sunken text-ink-soft'
                    }`}
                  >
                    {p.enabled ? dict.enterprise.enabled : dict.enterprise.disabled}
                  </span>
                </span>
              </div>
              <dl className="mt-2 grid gap-1.5 text-xs text-ink-soft sm:grid-cols-2">
                {p.issuer && (
                  <div>
                    <dt className="text-ink-faint">{dict.enterprise.issuer}</dt>
                    <dd dir="ltr" className="break-all">
                      {p.issuer}
                    </dd>
                  </div>
                )}
                {p.spEntityId && (
                  <div>
                    <dt className="text-ink-faint">{dict.enterprise.spEntityId}</dt>
                    <dd dir="ltr" className="break-all">
                      {p.spEntityId}
                    </dd>
                  </div>
                )}
                {p.acsUrl && (
                  <div>
                    <dt className="text-ink-faint">{dict.enterprise.acsUrl}</dt>
                    <dd dir="ltr" className="break-all">
                      {p.acsUrl}
                    </dd>
                  </div>
                )}
                <div>
                  <dt className="text-ink-faint">{dict.enterprise.enforceSso}</dt>
                  <dd>{p.enforceSSO ? dict.enterprise.yes : dict.enterprise.no}</dd>
                </div>
                <div>
                  <dt className="text-ink-faint">{dict.enterprise.allowPasswordFallback}</dt>
                  <dd>{p.allowPasswordFallback ? dict.enterprise.yes : dict.enterprise.no}</dd>
                </div>
                {p.domainRestriction && p.domainRestriction.length > 0 && (
                  <div className="sm:col-span-2">
                    <dt className="text-ink-faint">{dict.enterprise.domainRestriction}</dt>
                    <dd dir="ltr">{p.domainRestriction.join(', ')}</dd>
                  </div>
                )}
              </dl>
            </li>
          ))}
        </ul>
      )}

      {!notice && (
        <div className="mt-4">
          {showAdd ? (
            <AddIdentityForm
              dict={dict}
              onDone={() => {
                setShowAdd(false);
                void load();
              }}
              onCancel={() => setShowAdd(false)}
            />
          ) : (
            <button type="button" onClick={() => setShowAdd(true)} className="btn-outline px-3 py-2 text-sm">
              <Icon name="plus" width={16} height={16} />
              {dict.enterprise.addProvider}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function AddIdentityForm({
  dict,
  onDone,
  onCancel,
}: {
  dict: Dictionary;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [type, setType] = useState<'OIDC' | 'SAML'>('OIDC');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const body: Record<string, unknown> = {
      type,
      displayName: String(form.get('displayName') || ''),
      enforceSSO: form.get('enforceSSO') === 'on',
      allowPasswordFallback: form.get('allowPasswordFallback') === 'on',
    };
    const issuer = String(form.get('issuer') || '').trim();
    const clientIdRef = String(form.get('clientIdRef') || '').trim();
    const metadataRef = String(form.get('metadataRef') || '').trim();
    const spEntityId = String(form.get('spEntityId') || '').trim();
    const acsUrl = String(form.get('acsUrl') || '').trim();
    const domains = csvToList(String(form.get('domainRestriction') || ''));
    if (issuer) body.issuer = issuer;
    if (clientIdRef) body.clientIdRef = clientIdRef;
    if (metadataRef) body.metadataRef = metadataRef;
    if (spEntityId) body.spEntityId = spEntityId;
    if (acsUrl) body.acsUrl = acsUrl;
    if (domains.length) body.domainRestriction = domains;
    try {
      const res = await fetch('/api/org/enterprise/identity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => null);
        setError((b && b.error) || noticeFor(res.status, dict));
        return;
      }
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-3 p-4">
      <h3 className="text-sm font-semibold text-ink">{dict.enterprise.addProvider}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {labeledField(
          'idType',
          dict.enterprise.providerType,
          <select
            id="idType"
            value={type}
            onChange={(e) => setType(e.target.value as 'OIDC' | 'SAML')}
            className="field"
          >
            <option value="OIDC">{dict.enterprise.providerTypeOidc}</option>
            <option value="SAML">{dict.enterprise.providerTypeSaml}</option>
          </select>,
        )}
        {labeledField(
          'idName',
          dict.enterprise.providerDisplayName,
          <input id="idName" name="displayName" className="field" required dir="auto" />,
        )}
        {type === 'OIDC' &&
          labeledField('idIssuer', dict.enterprise.issuer, <input id="idIssuer" name="issuer" className="field" dir="ltr" />)}
        {type === 'OIDC' &&
          labeledField(
            'idClient',
            dict.enterprise.clientIdRef,
            <input id="idClient" name="clientIdRef" className="field" dir="ltr" />,
          )}
        {type === 'SAML' &&
          labeledField(
            'idMeta',
            dict.enterprise.metadataRef,
            <input id="idMeta" name="metadataRef" className="field" dir="ltr" />,
          )}
        {type === 'SAML' &&
          labeledField('idSp', dict.enterprise.spEntityId, <input id="idSp" name="spEntityId" className="field" dir="ltr" />)}
        {type === 'SAML' &&
          labeledField('idAcs', dict.enterprise.acsUrl, <input id="idAcs" name="acsUrl" className="field" dir="ltr" />)}
        {labeledField(
          'idDomains',
          dict.enterprise.domainRestriction,
          <input id="idDomains" name="domainRestriction" className="field" dir="ltr" />,
          dict.enterprise.domainRestrictionHint,
        )}
      </div>
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          <input type="checkbox" name="enforceSSO" className="h-4 w-4" />
          {dict.enterprise.enforceSso}
        </label>
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          <input type="checkbox" name="allowPasswordFallback" defaultChecked className="h-4 w-4" />
          {dict.enterprise.allowPasswordFallback}
        </label>
      </div>
      <EnvRefNote dict={dict} />
      {error && <Banner tone="error">{error}</Banner>}
      <div className="flex items-center gap-2">
        <button type="submit" disabled={busy} className="btn-primary px-4 py-2 text-sm">
          {busy ? dict.enterprise.adding : dict.enterprise.add}
        </button>
        <button type="button" onClick={onCancel} className="btn-ghost px-3 py-2 text-sm">
          {dict.enterprise.cancel}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Domains
// ---------------------------------------------------------------------------

interface DomainEntry {
  id: string;
  domain: string;
  status: string;
  verifiedAt: string | null;
}

function DomainsSection({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const [domains, setDomains] = useState<DomainEntry[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newDomain, setNewDomain] = useState('');
  const [txtRecord, setTxtRecord] = useState<{ domain: string; record: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fmt = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-US', { dateStyle: 'medium' });

  const load = useCallback(async () => {
    setNotice(null);
    try {
      const res = await fetch('/api/org/enterprise/domains', { cache: 'no-store' });
      if (!res.ok) {
        setNotice(noticeFor(res.status, dict));
        setDomains([]);
        return;
      }
      const body = await res.json();
      setDomains(Array.isArray(body.domains) ? body.domains : []);
    } catch {
      setNotice(dict.enterprise.loadError);
      setDomains([]);
    }
  }, [dict]);

  useEffect(() => {
    void load();
  }, [load]);

  async function claim(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!newDomain.trim()) return;
    setBusy(true);
    setError(null);
    setTxtRecord(null);
    try {
      const res = await fetch('/api/org/enterprise/domains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: newDomain.trim() }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError((body && body.error) || noticeFor(res.status, dict));
        return;
      }
      if (body?.txtRecord) setTxtRecord({ domain: body.domain, record: body.txtRecord });
      setNewDomain('');
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function verify(domain: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/org/enterprise/domains/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError((body && body.error) || noticeFor(res.status, dict));
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (domains === null) return <Loading />;

  return (
    <div className="mt-4">
      <h2 className="text-sm font-semibold text-ink">{dict.enterprise.domainsTitle}</h2>
      <p className="mt-1 text-sm text-ink-soft">{dict.enterprise.domainsDesc}</p>
      {notice && <SectionNotice tone="error">{notice}</SectionNotice>}

      {!notice && (
        <form onSubmit={claim} className="mt-4 flex flex-wrap gap-2">
          <input
            value={newDomain}
            onChange={(e) => setNewDomain(e.target.value)}
            placeholder={dict.enterprise.domainPlaceholder}
            dir="ltr"
            className="field max-w-xs flex-1"
          />
          <button type="submit" disabled={busy} className="btn-primary px-4 py-2 text-sm">
            {dict.enterprise.claimDomain}
          </button>
        </form>
      )}

      {error && <Banner tone="error">{error}</Banner>}

      {txtRecord && (
        <div className="mt-3 rounded-xl border border-gold/40 bg-gold/5 p-4">
          <h3 className="text-sm font-semibold text-ink">{dict.enterprise.txtRecordTitle}</h3>
          <p className="mt-1 text-xs text-ink-soft">{dict.enterprise.txtRecordHint}</p>
          <code className="mt-2 block break-all rounded bg-paper-sunken px-2 py-1.5 text-xs text-ink" dir="ltr">
            {txtRecord.record}
          </code>
        </div>
      )}

      {domains.length === 0 && !notice ? (
        <SectionNotice tone="muted">{dict.enterprise.domainsEmpty}</SectionNotice>
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {domains.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div className="min-w-0">
                <p className="font-medium text-ink" dir="ltr">
                  {d.domain}
                </p>
                {d.verifiedAt && (
                  <p className="mt-0.5 text-xs text-ink-faint">
                    {dict.enterprise.verifiedAt}: {fmt.format(new Date(d.verifiedAt))}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={d.status} dict={dict} />
                {d.status !== 'VERIFIED' && (
                  <button
                    type="button"
                    onClick={() => verify(d.domain)}
                    disabled={busy}
                    className="btn-ghost px-2.5 py-1 text-xs"
                  >
                    {busy ? dict.enterprise.verifying : dict.enterprise.verify}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Provisioning (SCIM)
// ---------------------------------------------------------------------------

interface ScimState {
  enabled: boolean;
  tokenPrefix: string | null;
  tokenLastFour: string | null;
  lastUsedAt: string | null;
  scimBaseUrl: string | null;
}

function ProvisioningSection({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const [state, setState] = useState<ScimState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fmt = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const load = useCallback(async () => {
    setNotice(null);
    try {
      const res = await fetch('/api/org/enterprise/scim', { cache: 'no-store' });
      if (!res.ok) {
        setNotice(noticeFor(res.status, dict));
        return;
      }
      setState(await res.json());
    } catch {
      setNotice(dict.enterprise.loadError);
    }
  }, [dict]);

  useEffect(() => {
    void load();
  }, [load]);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/org/enterprise/scim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError((body && body.error) || noticeFor(res.status, dict));
        return;
      }
      if (body?.token) setToken(body.token);
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (notice) {
    return (
      <div className="mt-4">
        <h2 className="text-sm font-semibold text-ink">{dict.enterprise.scimTitle}</h2>
        <SectionNotice tone="error">{notice}</SectionNotice>
      </div>
    );
  }
  if (!state) return <Loading />;

  return (
    <div className="mt-4">
      <h2 className="text-sm font-semibold text-ink">{dict.enterprise.scimTitle}</h2>
      <p className="mt-1 text-sm text-ink-soft">{dict.enterprise.scimDesc}</p>

      <div className="card mt-4 space-y-3 p-4">
        <span
          className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            state.enabled ? 'bg-success/15 text-success' : 'bg-paper-sunken text-ink-soft'
          }`}
        >
          {state.enabled ? dict.enterprise.scimEnabledLabel : dict.enterprise.scimDisabledLabel}
        </span>

        <div className="grid gap-2 sm:grid-cols-2">
          {state.scimBaseUrl && (
            <InfoTile
              label={dict.enterprise.scimBaseUrl}
              value={
                <span dir="ltr" className="break-all">
                  {state.scimBaseUrl}
                </span>
              }
            />
          )}
          {state.tokenPrefix && (
            <InfoTile
              label={dict.enterprise.scimTokenPrefix}
              value={
                <span dir="ltr">
                  {state.tokenPrefix}…{state.tokenLastFour}
                </span>
              }
            />
          )}
          {state.lastUsedAt && (
            <InfoTile label={dict.enterprise.scimLastUsed} value={fmt.format(new Date(state.lastUsedAt))} />
          )}
        </div>

        {token && (
          <div className="rounded-xl border border-gold/40 bg-gold/5 p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
              <Icon name="shield" width={16} height={16} />
              {dict.enterprise.tokenOnceTitle}
            </h3>
            <p className="mt-1 text-xs font-medium text-gold">{dict.enterprise.tokenOnceWarning}</p>
            <code className="mt-2 block break-all rounded bg-paper-sunken px-2 py-1.5 text-xs text-ink" dir="ltr">
              {token}
            </code>
          </div>
        )}

        {error && <Banner tone="error">{error}</Banner>}

        <button type="button" onClick={generate} disabled={busy} className="btn-primary px-4 py-2 text-sm">
          {busy
            ? dict.enterprise.generating
            : state.enabled
              ? dict.enterprise.regenerateToken
              : dict.enterprise.generateToken}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

interface BuiltinRole {
  slug: string;
  name: string;
  permissions: string[];
  systemRole: boolean;
}
interface CustomRole {
  id: string;
  slug: string;
  name: string;
  permissions: string[];
  enabled: boolean;
}
interface RolesData {
  builtin: BuiltinRole[];
  custom: CustomRole[];
  vocabulary: string[];
}

function permDomain(perm: string): string {
  const i = perm.indexOf('.');
  return i === -1 ? perm : perm.slice(0, i);
}

function RolesSection({ dict }: { dict: Dictionary }) {
  const [data, setData] = useState<RolesData | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async () => {
    setNotice(null);
    try {
      const res = await fetch('/api/org/enterprise/roles', { cache: 'no-store' });
      if (!res.ok) {
        setNotice(noticeFor(res.status, dict));
        return;
      }
      const body = await res.json();
      setData({
        builtin: Array.isArray(body.builtin) ? body.builtin : [],
        custom: Array.isArray(body.custom) ? body.custom : [],
        vocabulary: Array.isArray(body.vocabulary) ? body.vocabulary : [],
      });
    } catch {
      setNotice(dict.enterprise.loadError);
    }
  }, [dict]);

  useEffect(() => {
    void load();
  }, [load]);

  if (notice) {
    return (
      <div className="mt-4">
        <h2 className="text-sm font-semibold text-ink">{dict.enterprise.rolesTitle}</h2>
        <SectionNotice tone="error">{notice}</SectionNotice>
      </div>
    );
  }
  if (!data) return <Loading />;

  return (
    <div className="mt-4">
      <h2 className="text-sm font-semibold text-ink">{dict.enterprise.rolesTitle}</h2>
      <p className="mt-1 text-sm text-ink-soft">{dict.enterprise.rolesDesc}</p>

      <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-ink-faint">
        {dict.enterprise.builtinRoles}
      </h3>
      <ul className="mt-2 space-y-2">
        {data.builtin.map((r) => (
          <li key={r.slug} className="card flex flex-wrap items-center justify-between gap-2 p-3">
            <span className="flex items-center gap-2">
              <span className="font-medium text-ink" dir="auto">
                {r.name}
              </span>
              {r.systemRole && (
                <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold text-accent">
                  {dict.enterprise.systemRole}
                </span>
              )}
            </span>
            <span className="text-xs text-ink-faint">
              {r.permissions.length} {dict.enterprise.permissionsCount}
            </span>
          </li>
        ))}
      </ul>

      <h3 className="mt-6 text-xs font-semibold uppercase tracking-wide text-ink-faint">
        {dict.enterprise.customRoles}
      </h3>
      {data.custom.length === 0 ? (
        <SectionNotice tone="muted">{dict.enterprise.customRolesEmpty}</SectionNotice>
      ) : (
        <ul className="mt-2 space-y-2">
          {data.custom.map((r) => (
            <li key={r.id} className="card p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-ink" dir="auto">
                  {r.name}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    r.enabled ? 'bg-success/15 text-success' : 'bg-paper-sunken text-ink-soft'
                  }`}
                >
                  {r.enabled ? dict.enterprise.enabled : dict.enterprise.disabled}
                </span>
              </div>
              {r.permissions.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {r.permissions.map((p) => (
                    <code key={p} className="rounded bg-paper-sunken px-1.5 py-0.5 text-[11px] text-ink-soft" dir="ltr">
                      {p}
                    </code>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4">
        {showAdd ? (
          <CreateRoleForm
            dict={dict}
            vocabulary={data.vocabulary}
            onDone={() => {
              setShowAdd(false);
              void load();
            }}
            onCancel={() => setShowAdd(false)}
          />
        ) : (
          <button type="button" onClick={() => setShowAdd(true)} className="btn-outline px-3 py-2 text-sm">
            <Icon name="plus" width={16} height={16} />
            {dict.enterprise.createRole}
          </button>
        )}
      </div>
    </div>
  );
}

function CreateRoleForm({
  dict,
  vocabulary,
  onDone,
  onCancel,
}: {
  dict: Dictionary;
  vocabulary: string[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Group vocabulary by domain prefix for a readable checkbox grid.
  const groups = new Map<string, string[]>();
  for (const perm of vocabulary) {
    const d = permDomain(perm);
    if (!groups.has(d)) groups.set(d, []);
    groups.get(d)!.push(perm);
  }

  function toggle(perm: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(perm)) next.delete(perm);
      else next.add(perm);
      return next;
    });
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/org/enterprise/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          ...(description.trim() ? { description: description.trim() } : {}),
          permissions: Array.from(selected),
        }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => null);
        setError((b && b.error) || noticeFor(res.status, dict));
        return;
      }
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-3 p-4">
      <h3 className="text-sm font-semibold text-ink">{dict.enterprise.createRole}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {labeledField(
          'roleName',
          dict.enterprise.roleName,
          <input id="roleName" value={name} onChange={(e) => setName(e.target.value)} className="field" required dir="auto" />,
        )}
        {labeledField(
          'roleDesc',
          dict.enterprise.roleDescription,
          <input
            id="roleDesc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="field"
            dir="auto"
          />,
        )}
      </div>

      <div>
        <p className="mb-2 text-sm text-ink-soft">{dict.enterprise.permissions}</p>
        <div className="space-y-3">
          {Array.from(groups.entries()).map(([domain, perms]) => (
            <div key={domain} className="rounded-xl border border-line p-3">
              <p className="text-xs font-semibold text-ink-soft" dir="ltr">
                {domain}
              </p>
              <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                {perms.map((perm) => (
                  <label key={perm} className="flex items-center gap-2 text-xs text-ink-soft">
                    <input
                      type="checkbox"
                      checked={selected.has(perm)}
                      onChange={() => toggle(perm)}
                      className="h-4 w-4"
                    />
                    <code dir="ltr">{perm}</code>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {error && <Banner tone="error">{error}</Banner>}
      <div className="flex items-center gap-2">
        <button type="submit" disabled={busy} className="btn-primary px-4 py-2 text-sm">
          {busy ? dict.enterprise.creating : dict.enterprise.createRole}
        </button>
        <button type="button" onClick={onCancel} className="btn-ghost px-3 py-2 text-sm">
          {dict.enterprise.cancel}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// AI Policy
// ---------------------------------------------------------------------------

interface SecurityPolicy {
  externalAIAllowed: boolean;
  webSearchMode: string;
  personalConnectorsAllowed: boolean;
  agentsEnabled: boolean;
  externalWritesEnabled: boolean;
  scheduledAutomationsEnabled: boolean;
  scheduledWritesEnabled: boolean;
  memoryEnabled: boolean;
  multimodalEnabled: boolean;
  researchEnabled: boolean;
  marketplaceMode: string;
  dataExportAllowed: boolean;
  mfaRequired: boolean;
  allowedAIProviders: string[];
  allowedModelProfiles: string[];
  allowedConnectors: string[];
  maxAgentSteps: number;
}

interface PolicyResponse {
  policy: SecurityPolicy;
  effective: Partial<SecurityPolicy> & Record<string, unknown>;
  deploymentProfile: { displayName?: string; slug?: string } | string | null;
}

function DeploymentBanner({ profile, dict }: { profile: PolicyResponse['deploymentProfile']; dict: Dictionary }) {
  const name =
    typeof profile === 'string'
      ? profile
      : profile && typeof profile === 'object'
        ? profile.displayName || profile.slug || null
        : null;
  return (
    <div className="mt-4 rounded-xl border border-accent/30 bg-accent-soft px-3 py-2 text-sm text-accent">
      <span className="font-semibold">{dict.enterprise.deploymentProfile}:</span>{' '}
      <span dir="auto">{name || dict.enterprise.noProfileAssigned}</span>
    </div>
  );
}

const WEB_MODES = ['DISABLED', 'PUBLIC_ONLY', 'APPROVED_DOMAINS', 'STANDARD'] as const;
const MARKET_MODES = ['PUBLIC_ALLOWED', 'CURATED_ONLY', 'ORGANIZATION_ONLY', 'DISABLED'] as const;

function webModeLabel(m: string, dict: Dictionary): string {
  const map: Record<string, string> = {
    DISABLED: dict.enterprise.webDisabled,
    PUBLIC_ONLY: dict.enterprise.webPublicOnly,
    APPROVED_DOMAINS: dict.enterprise.webApprovedDomains,
    STANDARD: dict.enterprise.webStandard,
  };
  return map[m] ?? m;
}
function marketModeLabel(m: string, dict: Dictionary): string {
  const map: Record<string, string> = {
    PUBLIC_ALLOWED: dict.enterprise.marketPublic,
    CURATED_ONLY: dict.enterprise.marketCurated,
    ORGANIZATION_ONLY: dict.enterprise.marketOrg,
    DISABLED: dict.enterprise.marketDisabled,
  };
  return map[m] ?? m;
}

function PolicySection({ dict }: { dict: Dictionary }) {
  const [data, setData] = useState<PolicyResponse | null>(null);
  const [form, setForm] = useState<SecurityPolicy | null>(null);
  const [initial, setInitial] = useState<SecurityPolicy | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    setNotice(null);
    try {
      const res = await fetch('/api/org/enterprise/security-policy', { cache: 'no-store' });
      if (!res.ok) {
        setNotice(noticeFor(res.status, dict));
        return;
      }
      const body: PolicyResponse = await res.json();
      setData(body);
      setForm({ ...body.policy });
      setInitial({ ...body.policy });
    } catch {
      setNotice(dict.enterprise.loadError);
    }
  }, [dict]);

  useEffect(() => {
    void load();
  }, [load]);

  function set<K extends keyof SecurityPolicy>(key: K, value: SecurityPolicy[K]) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
    setSaved(false);
  }

  const highRiskChanged =
    !!form &&
    !!initial &&
    (form.externalAIAllowed !== initial.externalAIAllowed ||
      form.externalWritesEnabled !== initial.externalWritesEnabled);

  async function save(withConfirm: boolean) {
    if (!form) return;
    if (highRiskChanged && !withConfirm) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const body: Record<string, unknown> = { ...form };
      if (withConfirm) body.confirm = true;
      const res = await fetch('/api/org/enterprise/security-policy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const b = await res.json().catch(() => null);
      if (res.status === 409 && b?.code === 'confirm_required') {
        setConfirming(true);
        return;
      }
      if (!res.ok) {
        setError((b && b.error) || noticeFor(res.status, dict));
        return;
      }
      setSaved(true);
      setConfirming(false);
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (notice) {
    return (
      <div className="mt-4">
        <h2 className="text-sm font-semibold text-ink">{dict.enterprise.policyTitle}</h2>
        <SectionNotice tone="error">{notice}</SectionNotice>
      </div>
    );
  }
  if (!data || !form) return <Loading />;

  const confirmMsg =
    form.externalAIAllowed !== initial?.externalAIAllowed &&
    form.externalWritesEnabled !== initial?.externalWritesEnabled
      ? dict.enterprise.confirmBoth
      : form.externalAIAllowed !== initial?.externalAIAllowed
        ? dict.enterprise.confirmExternalAI
        : dict.enterprise.confirmExternalWrites;

  return (
    <div className="mt-4">
      <h2 className="text-sm font-semibold text-ink">{dict.enterprise.policyTitle}</h2>
      <p className="mt-1 text-sm text-ink-soft">{dict.enterprise.policyDesc}</p>

      <DeploymentBanner profile={data.deploymentProfile} dict={dict} />

      {/* Editable toggles */}
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <Toggle
          checked={form.externalAIAllowed}
          onChange={(v) => set('externalAIAllowed', v)}
          label={dict.enterprise.externalAIAllowed}
          highRisk
          riskLabel={dict.enterprise.highRiskBadge}
        />
        <Toggle
          checked={form.externalWritesEnabled}
          onChange={(v) => set('externalWritesEnabled', v)}
          label={dict.enterprise.externalWritesEnabled}
          highRisk
          riskLabel={dict.enterprise.highRiskBadge}
        />
        <Toggle checked={form.personalConnectorsAllowed} onChange={(v) => set('personalConnectorsAllowed', v)} label={dict.enterprise.personalConnectorsAllowed} />
        <Toggle checked={form.agentsEnabled} onChange={(v) => set('agentsEnabled', v)} label={dict.enterprise.agentsEnabled} />
        <Toggle checked={form.scheduledAutomationsEnabled} onChange={(v) => set('scheduledAutomationsEnabled', v)} label={dict.enterprise.scheduledAutomationsEnabled} />
        <Toggle checked={form.scheduledWritesEnabled} onChange={(v) => set('scheduledWritesEnabled', v)} label={dict.enterprise.scheduledWritesEnabled} />
        <Toggle checked={form.memoryEnabled} onChange={(v) => set('memoryEnabled', v)} label={dict.enterprise.memoryEnabled} />
        <Toggle checked={form.multimodalEnabled} onChange={(v) => set('multimodalEnabled', v)} label={dict.enterprise.multimodalEnabled} />
        <Toggle checked={form.researchEnabled} onChange={(v) => set('researchEnabled', v)} label={dict.enterprise.researchEnabled} />
        <Toggle checked={form.dataExportAllowed} onChange={(v) => set('dataExportAllowed', v)} label={dict.enterprise.dataExportAllowed} />
        <Toggle checked={form.mfaRequired} onChange={(v) => set('mfaRequired', v)} label={dict.enterprise.mfaRequired} />
      </div>

      {/* Enums */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {labeledField(
          'webMode',
          dict.enterprise.webSearchMode,
          <select id="webMode" value={form.webSearchMode} onChange={(e) => set('webSearchMode', e.target.value)} className="field">
            {WEB_MODES.map((m) => (
              <option key={m} value={m}>
                {webModeLabel(m, dict)}
              </option>
            ))}
          </select>,
        )}
        {labeledField(
          'marketMode',
          dict.enterprise.marketplaceMode,
          <select id="marketMode" value={form.marketplaceMode} onChange={(e) => set('marketplaceMode', e.target.value)} className="field">
            {MARKET_MODES.map((m) => (
              <option key={m} value={m}>
                {marketModeLabel(m, dict)}
              </option>
            ))}
          </select>,
        )}
        {labeledField(
          'maxSteps',
          dict.enterprise.maxAgentSteps,
          <input
            id="maxSteps"
            type="number"
            min={0}
            value={form.maxAgentSteps}
            onChange={(e) => set('maxAgentSteps', Number(e.target.value))}
            className="field"
            dir="ltr"
          />,
        )}
      </div>

      {/* Allowlists */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {labeledField(
          'allowProviders',
          dict.enterprise.allowedAIProviders,
          <input
            id="allowProviders"
            defaultValue={listToCsv(form.allowedAIProviders)}
            onChange={(e) => set('allowedAIProviders', csvToList(e.target.value))}
            className="field"
            dir="ltr"
          />,
          dict.enterprise.listHint,
        )}
        {labeledField(
          'allowModels',
          dict.enterprise.allowedModelProfiles,
          <input
            id="allowModels"
            defaultValue={listToCsv(form.allowedModelProfiles)}
            onChange={(e) => set('allowedModelProfiles', csvToList(e.target.value))}
            className="field"
            dir="ltr"
          />,
          dict.enterprise.listHint,
        )}
        {labeledField(
          'allowConnectors',
          dict.enterprise.allowedConnectors,
          <input
            id="allowConnectors"
            defaultValue={listToCsv(form.allowedConnectors)}
            onChange={(e) => set('allowedConnectors', csvToList(e.target.value))}
            className="field"
            dir="ltr"
          />,
          dict.enterprise.listHint,
        )}
      </div>

      {error && <Banner tone="error">{error}</Banner>}

      <div className="mt-4 flex items-center gap-3">
        <button type="button" onClick={() => save(false)} disabled={busy} className="btn-primary px-4 py-2 text-sm">
          {busy ? dict.enterprise.saving : dict.enterprise.save}
        </button>
        {saved && <span className="text-sm font-medium text-success">{dict.enterprise.saved}</span>}
      </div>

      {/* Confirm dialog for high-risk toggles */}
      {confirming && (
        <div className="mt-4 rounded-xl border border-danger/40 bg-danger/5 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-danger">
            <Icon name="shield" width={16} height={16} />
            {dict.enterprise.confirmTitle}
          </h3>
          <p className="mt-1 text-sm text-ink-soft">{confirmMsg}</p>
          <div className="mt-3 flex items-center gap-2">
            <button type="button" onClick={() => save(true)} disabled={busy} className="btn-primary px-4 py-2 text-sm">
              {busy ? dict.enterprise.saving : dict.enterprise.confirm}
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="btn-ghost px-3 py-2 text-sm">
              {dict.enterprise.cancel}
            </button>
          </div>
        </div>
      )}

      {/* Effective (read-only folded) policy */}
      <EffectivePolicy effective={data.effective} dict={dict} />
    </div>
  );
}

function EffectivePolicy({ effective, dict }: { effective: Record<string, unknown>; dict: Dictionary }) {
  const bool = (v: unknown) => (v ? dict.enterprise.enabled : dict.enterprise.disabled);
  const rows: Array<{ label: string; value: ReactNode }> = [
    { label: dict.enterprise.externalAIAllowed, value: bool(effective.externalAIAllowed) },
    { label: dict.enterprise.externalWritesEnabled, value: bool(effective.externalWritesEnabled) },
    {
      label: dict.enterprise.webSearchMode,
      value: typeof effective.webSearchMode === 'string' ? webModeLabel(effective.webSearchMode, dict) : '—',
    },
    {
      label: dict.enterprise.marketplaceMode,
      value: typeof effective.marketplaceMode === 'string' ? marketModeLabel(effective.marketplaceMode, dict) : '—',
    },
    { label: dict.enterprise.mfaRequired, value: bool(effective.mfaRequired) },
    { label: dict.enterprise.researchEnabled, value: bool(effective.researchEnabled) },
  ];
  return (
    <section className="mt-6 rounded-2xl border border-line bg-paper-sunken/40 p-4">
      <h3 className="text-sm font-semibold text-ink">{dict.enterprise.effectiveTitle}</h3>
      <p className="mt-1 text-xs text-ink-soft">{dict.enterprise.effectiveNote}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {rows.map((r) => (
          <InfoTile key={r.label} label={r.label} value={r.value} />
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Data & residency + retention
// ---------------------------------------------------------------------------

interface ResidencyEffective {
  requiredRegions: string[];
  allowedRegions: string[];
  storageRegion: string | null;
  vectorRegion: string | null;
  modelInferenceRegion: string | null;
  externalTransferAllowed: boolean;
}

function DataSection({ dict }: { dict: Dictionary }) {
  return (
    <div className="mt-4 space-y-8">
      <ResidencyBlock dict={dict} />
      <RetentionBlock dict={dict} />
    </div>
  );
}

function ResidencyBlock({ dict }: { dict: Dictionary }) {
  const [eff, setEff] = useState<ResidencyEffective | null>(null);
  const [allowed, setAllowed] = useState<Set<Region>>(new Set());
  const [required, setRequired] = useState<Set<Region>>(new Set());
  const [storage, setStorage] = useState('');
  const [vector, setVector] = useState('');
  const [inference, setInference] = useState('');
  const [transfer, setTransfer] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setNotice(null);
    try {
      const res = await fetch('/api/org/enterprise/residency', { cache: 'no-store' });
      if (!res.ok) {
        setNotice(noticeFor(res.status, dict));
        return;
      }
      const body = await res.json();
      const e: ResidencyEffective = body.effective ?? {};
      setEff(e);
      setAllowed(new Set((e.allowedRegions ?? []) as Region[]));
      setRequired(new Set((e.requiredRegions ?? []) as Region[]));
      setStorage(e.storageRegion ?? '');
      setVector(e.vectorRegion ?? '');
      setInference(e.modelInferenceRegion ?? '');
      setTransfer(Boolean(e.externalTransferAllowed));
    } catch {
      setNotice(dict.enterprise.loadError);
    }
  }, [dict]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleSet(set: Set<Region>, setter: (s: Set<Region>) => void, r: Region) {
    const next = new Set(set);
    if (next.has(r)) next.delete(r);
    else next.add(r);
    setter(next);
    setSaved(false);
  }

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch('/api/org/enterprise/residency', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          allowedRegions: Array.from(allowed),
          requiredRegions: Array.from(required),
          storageRegion: storage || null,
          vectorRegion: vector || null,
          modelInferenceRegion: inference || null,
          externalTransferAllowed: transfer,
        }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => null);
        setError((b && b.error) || noticeFor(res.status, dict));
        return;
      }
      setSaved(true);
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (notice) {
    return (
      <section>
        <h2 className="text-sm font-semibold text-ink">{dict.enterprise.residencyTitle}</h2>
        <SectionNotice tone="error">{notice}</SectionNotice>
      </section>
    );
  }
  if (!eff) return <Loading />;

  const regionSelect = (id: string, label: string, value: string, setter: (v: string) => void) =>
    labeledField(
      id,
      label,
      <select
        id={id}
        value={value}
        onChange={(e) => {
          setter(e.target.value);
          setSaved(false);
        }}
        className="field"
      >
        <option value="">{dict.enterprise.regionUnset}</option>
        {REGIONS.map((r) => (
          <option key={r} value={r}>
            {regionLabel(r, dict)}
          </option>
        ))}
      </select>,
    );

  return (
    <section>
      <h2 className="text-sm font-semibold text-ink">{dict.enterprise.residencyTitle}</h2>
      <p className="mt-1 text-sm text-ink-soft">{dict.enterprise.residencyDesc}</p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-2 text-sm text-ink-soft">{dict.enterprise.allowedRegions}</p>
          <div className="flex flex-wrap gap-2">
            {REGIONS.map((r) => (
              <label key={r} className="flex items-center gap-1.5 text-xs text-ink-soft">
                <input type="checkbox" checked={allowed.has(r)} onChange={() => toggleSet(allowed, setAllowed, r)} className="h-4 w-4" />
                {regionLabel(r, dict)}
              </label>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 text-sm text-ink-soft">{dict.enterprise.requiredRegions}</p>
          <div className="flex flex-wrap gap-2">
            {REGIONS.map((r) => (
              <label key={r} className="flex items-center gap-1.5 text-xs text-ink-soft">
                <input type="checkbox" checked={required.has(r)} onChange={() => toggleSet(required, setRequired, r)} className="h-4 w-4" />
                {regionLabel(r, dict)}
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {regionSelect('storageRegion', dict.enterprise.storageRegion, storage, setStorage)}
        {regionSelect('vectorRegion', dict.enterprise.vectorRegion, vector, setVector)}
        {regionSelect('inferenceRegion', dict.enterprise.modelInferenceRegion, inference, setInference)}
      </div>

      <div className="mt-4">
        <Toggle checked={transfer} onChange={(v) => { setTransfer(v); setSaved(false); }} label={dict.enterprise.externalTransferAllowed} />
      </div>

      {error && <Banner tone="error">{error}</Banner>}
      <div className="mt-4 flex items-center gap-3">
        <button type="button" onClick={save} disabled={busy} className="btn-primary px-4 py-2 text-sm">
          {busy ? dict.enterprise.saving : dict.enterprise.save}
        </button>
        {saved && <span className="text-sm font-medium text-success">{dict.enterprise.saved}</span>}
      </div>
    </section>
  );
}

interface RetentionEffective {
  deletionMode: string;
  legalHoldEnabled: boolean;
  [key: string]: unknown;
}

function RetentionBlock({ dict }: { dict: Dictionary }) {
  const [eff, setEff] = useState<RetentionEffective | null>(null);
  const [dayFields, setDayFields] = useState<Record<string, number>>({});
  const [deletionMode, setDeletionMode] = useState('SOFT_DELETE');
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setNotice(null);
    try {
      const res = await fetch('/api/org/enterprise/retention', { cache: 'no-store' });
      if (!res.ok) {
        setNotice(noticeFor(res.status, dict));
        return;
      }
      const body = await res.json();
      const e: RetentionEffective = body.effective ?? { deletionMode: 'SOFT_DELETE', legalHoldEnabled: false };
      setEff(e);
      const days: Record<string, number> = {};
      for (const [k, v] of Object.entries(e)) {
        if (/Days$/.test(k) && typeof v === 'number') days[k] = v;
      }
      setDayFields(days);
      if (typeof e.deletionMode === 'string') setDeletionMode(e.deletionMode);
    } catch {
      setNotice(dict.enterprise.loadError);
    }
  }, [dict]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch('/api/org/enterprise/retention', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...dayFields, deletionMode }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => null);
        setError((b && b.error) || noticeFor(res.status, dict));
        return;
      }
      setSaved(true);
      await load();
    } finally {
      setBusy(false);
    }
  }

  // Humanize a retention day-field key (e.g. "conversationRetentionDays" → "conversation retention").
  function dayLabel(key: string): string {
    return key
      .replace(/Days$/, '')
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, (c) => c.toUpperCase())
      .trim();
  }

  if (notice) {
    return (
      <section>
        <h2 className="text-sm font-semibold text-ink">{dict.enterprise.retentionTitle}</h2>
        <SectionNotice tone="error">{notice}</SectionNotice>
      </section>
    );
  }
  if (!eff) return <Loading />;

  const dayKeys = Object.keys(dayFields);

  return (
    <section>
      <h2 className="text-sm font-semibold text-ink">{dict.enterprise.retentionTitle}</h2>
      <p className="mt-1 text-sm text-ink-soft">{dict.enterprise.retentionDesc}</p>
      <p className="mt-2 rounded-lg bg-gold/10 px-3 py-2 text-xs text-gold">{dict.enterprise.retentionStagedNote}</p>

      {dayKeys.length > 0 && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {dayKeys.map((key) => (
            <div key={key}>
              <label htmlFor={`ret-${key}`} className="mb-1.5 block text-sm text-ink-soft" dir="ltr">
                {dayLabel(key)} ({dict.enterprise.days})
              </label>
              <input
                id={`ret-${key}`}
                type="number"
                min={0}
                value={dayFields[key]}
                onChange={(e) => {
                  setDayFields((prev) => ({ ...prev, [key]: Number(e.target.value) }));
                  setSaved(false);
                }}
                className="field"
                dir="ltr"
              />
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {labeledField(
          'deletionMode',
          dict.enterprise.deletionMode,
          <select
            id="deletionMode"
            value={deletionMode}
            onChange={(e) => {
              setDeletionMode(e.target.value);
              setSaved(false);
            }}
            className="field"
          >
            <option value="SOFT_DELETE">{dict.enterprise.softDelete}</option>
            <option value="HARD_DELETE">{dict.enterprise.hardDelete}</option>
          </select>,
          dict.enterprise.retentionDaysHint,
        )}
        <InfoTile
          label={dict.enterprise.legalHold}
          value={eff.legalHoldEnabled ? dict.enterprise.enabled : dict.enterprise.disabled}
        />
      </div>

      {error && <Banner tone="error">{error}</Banner>}
      <div className="mt-4 flex items-center gap-3">
        <button type="button" onClick={save} disabled={busy} className="btn-primary px-4 py-2 text-sm">
          {busy ? dict.enterprise.saving : dict.enterprise.save}
        </button>
        {saved && <span className="text-sm font-medium text-success">{dict.enterprise.saved}</span>}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Integrations (private providers)
// ---------------------------------------------------------------------------

interface PrivateProvider {
  slug: string;
  displayName: string;
  region: string | null;
  enabled: boolean;
  health: string | null;
  models: string[] | number | null;
  avgLatencyMs: number | null;
}

function healthClass(health: string | null): string {
  switch (health) {
    case 'HEALTHY':
    case 'healthy':
      return 'bg-success/15 text-success';
    case 'DEGRADED':
    case 'degraded':
      return 'bg-gold/15 text-gold';
    case 'UNHEALTHY':
    case 'unhealthy':
      return 'bg-danger/10 text-danger';
    default:
      return 'bg-paper-sunken text-ink-soft';
  }
}
function healthLabel(health: string | null, dict: Dictionary): string {
  const key = (health ?? '').toUpperCase();
  const map: Record<string, string> = {
    HEALTHY: dict.enterprise.healthy,
    DEGRADED: dict.enterprise.degraded,
    UNHEALTHY: dict.enterprise.unhealthy,
  };
  return map[key] ?? dict.enterprise.healthUnknown;
}

function IntegrationsSection({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const [providers, setProviders] = useState<PrivateProvider[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const num = new Intl.NumberFormat(locale === 'ar' ? 'ar-AE' : 'en-US');

  const load = useCallback(async () => {
    setNotice(null);
    try {
      const res = await fetch('/api/org/enterprise/providers', { cache: 'no-store' });
      if (!res.ok) {
        setNotice(noticeFor(res.status, dict));
        setProviders([]);
        return;
      }
      const body = await res.json();
      setProviders(Array.isArray(body.providers) ? body.providers : []);
    } catch {
      setNotice(dict.enterprise.loadError);
      setProviders([]);
    }
  }, [dict]);

  useEffect(() => {
    void load();
  }, [load]);

  if (providers === null) return <Loading />;

  return (
    <div className="mt-4">
      <h2 className="text-sm font-semibold text-ink">{dict.enterprise.integrationsTitle}</h2>
      <p className="mt-1 text-sm text-ink-soft">{dict.enterprise.integrationsDesc}</p>
      {notice && <SectionNotice tone="error">{notice}</SectionNotice>}

      {providers.length === 0 && !notice ? (
        <SectionNotice tone="muted">{dict.enterprise.integrationsEmpty}</SectionNotice>
      ) : (
        <ul className="mt-4 space-y-3">
          {providers.map((p) => (
            <li key={p.slug} className="card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-ink" dir="auto">
                  {p.displayName}
                </span>
                <span className="flex items-center gap-1.5">
                  {p.health != null && (
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${healthClass(p.health)}`}>
                      {healthLabel(p.health, dict)}
                    </span>
                  )}
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      p.enabled ? 'bg-success/15 text-success' : 'bg-paper-sunken text-ink-soft'
                    }`}
                  >
                    {p.enabled ? dict.enterprise.enabled : dict.enterprise.disabled}
                  </span>
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft">
                <span dir="ltr">{p.slug}</span>
                {p.region && <span>{regionLabel(p.region, dict)}</span>}
                {typeof p.avgLatencyMs === 'number' && (
                  <span>
                    {dict.enterprise.avgLatency}: {num.format(p.avgLatencyMs)} ms
                  </span>
                )}
                {Array.isArray(p.models) && (
                  <span>
                    {dict.enterprise.models}: {num.format(p.models.length)}
                  </span>
                )}
                {typeof p.models === 'number' && (
                  <span>
                    {dict.enterprise.models}: {num.format(p.models)}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {!notice && (
        <div className="mt-4">
          {showAdd ? (
            <AddProviderForm
              dict={dict}
              onDone={() => {
                setShowAdd(false);
                void load();
              }}
              onCancel={() => setShowAdd(false)}
            />
          ) : (
            <button type="button" onClick={() => setShowAdd(true)} className="btn-outline px-3 py-2 text-sm">
              <Icon name="plus" width={16} height={16} />
              {dict.enterprise.integrationsTitle}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function AddProviderForm({
  dict,
  onDone,
  onCancel,
}: {
  dict: Dictionary;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const body: Record<string, unknown> = {
      slug: String(form.get('slug') || '').trim(),
      displayName: String(form.get('displayName') || '').trim(),
      type: String(form.get('type') || '').trim(),
      region: String(form.get('region') || '').trim(),
    };
    const baseUrlEnvRef = String(form.get('baseUrlEnvRef') || '').trim();
    const apiKeyEnvRef = String(form.get('apiKeyEnvRef') || '').trim();
    if (baseUrlEnvRef) body.baseUrlEnvRef = baseUrlEnvRef;
    if (apiKeyEnvRef) body.apiKeyEnvRef = apiKeyEnvRef;
    try {
      const res = await fetch('/api/org/enterprise/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => null);
        setError((b && b.error) || noticeFor(res.status, dict));
        return;
      }
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-3 p-4">
      <h3 className="text-sm font-semibold text-ink">{dict.enterprise.integrationsTitle}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {labeledField('provSlug', dict.enterprise.providerSlug, <input id="provSlug" name="slug" className="field" required dir="ltr" />)}
        {labeledField(
          'provName',
          dict.enterprise.providerDisplayName,
          <input id="provName" name="displayName" className="field" required dir="auto" />,
        )}
        {labeledField('provType', dict.enterprise.providerType, <input id="provType" name="type" className="field" required dir="ltr" />)}
        {labeledField(
          'provRegion',
          dict.enterprise.providerRegion,
          <select id="provRegion" name="region" className="field">
            <option value="">{dict.enterprise.regionUnset}</option>
            {REGIONS.map((r) => (
              <option key={r} value={r}>
                {regionLabel(r, dict)}
              </option>
            ))}
          </select>,
        )}
        {labeledField('provBase', dict.enterprise.baseUrlEnvRef, <input id="provBase" name="baseUrlEnvRef" className="field" dir="ltr" />)}
        {labeledField('provKey', dict.enterprise.apiKeyEnvRef, <input id="provKey" name="apiKeyEnvRef" className="field" dir="ltr" />)}
      </div>
      <EnvRefNote dict={dict} />
      {error && <Banner tone="error">{error}</Banner>}
      <div className="flex items-center gap-2">
        <button type="submit" disabled={busy} className="btn-primary px-4 py-2 text-sm">
          {busy ? dict.enterprise.adding : dict.enterprise.add}
        </button>
        <button type="button" onClick={onCancel} className="btn-ghost px-3 py-2 text-sm">
          {dict.enterprise.cancel}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

interface AuditEvent {
  id: string;
  event: string;
  actorUserId: string | null;
  userId: string | null;
  ip: string | null;
  metadata: unknown;
  createdAt: string;
}

function AuditSection({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [event, setEvent] = useState('');
  const [actor, setActor] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const fmt = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const load = useCallback(async () => {
    setNotice(null);
    setEvents(null);
    try {
      const p = new URLSearchParams();
      if (event.trim()) p.set('event', event.trim());
      if (actor.trim()) p.set('actor', actor.trim());
      if (from) p.set('from', from);
      if (to) p.set('to', to);
      p.set('limit', '100');
      const res = await fetch(`/api/org/enterprise/audit?${p.toString()}`, { cache: 'no-store' });
      if (!res.ok) {
        setNotice(noticeFor(res.status, dict));
        setEvents([]);
        return;
      }
      const body = await res.json();
      setEvents(Array.isArray(body.events) ? body.events : []);
    } catch {
      setNotice(dict.enterprise.loadError);
      setEvents([]);
    }
  }, [dict, event, actor, from, to]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function clearFilters() {
    setEvent('');
    setActor('');
    setFrom('');
    setTo('');
  }

  const exportQuery = () => {
    const p = new URLSearchParams();
    if (event.trim()) p.set('event', event.trim());
    if (actor.trim()) p.set('actor', actor.trim());
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    return p.toString();
  };

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-ink">{dict.enterprise.auditTitle}</h2>
          <p className="mt-1 text-sm text-ink-soft">{dict.enterprise.auditDesc}</p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`/api/org/enterprise/audit/export?format=csv${exportQuery() ? `&${exportQuery()}` : ''}`}
            className="btn-ghost px-2.5 py-1.5 text-xs"
          >
            {dict.enterprise.exportCsv}
          </a>
          <a
            href={`/api/org/enterprise/audit/export?format=json${exportQuery() ? `&${exportQuery()}` : ''}`}
            className="btn-ghost px-2.5 py-1.5 text-xs"
          >
            {dict.enterprise.exportJson}
          </a>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-4">
        {labeledField('audEvent', dict.enterprise.filterEvent, <input id="audEvent" value={event} onChange={(e) => setEvent(e.target.value)} className="field" dir="ltr" />)}
        {labeledField('audActor', dict.enterprise.filterActor, <input id="audActor" value={actor} onChange={(e) => setActor(e.target.value)} className="field" dir="ltr" />)}
        {labeledField('audFrom', dict.enterprise.filterFrom, <input id="audFrom" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="field" dir="ltr" />)}
        {labeledField('audTo', dict.enterprise.filterTo, <input id="audTo" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="field" dir="ltr" />)}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button type="button" onClick={load} className="btn-primary px-3 py-1.5 text-sm">
          {dict.enterprise.applyFilters}
        </button>
        <button type="button" onClick={() => { clearFilters(); }} className="btn-ghost px-3 py-1.5 text-sm">
          {dict.enterprise.clearFilters}
        </button>
      </div>

      {notice && <SectionNotice tone="error">{notice}</SectionNotice>}

      {events === null ? (
        <Loading />
      ) : events.length === 0 && !notice ? (
        <SectionNotice tone="muted">{dict.enterprise.auditEmpty}</SectionNotice>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-start text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-ink-faint">
                <th className="px-2 py-1 text-start font-medium">{dict.enterprise.event}</th>
                <th className="px-2 py-1 text-start font-medium">{dict.enterprise.actor}</th>
                <th className="px-2 py-1 text-start font-medium">{dict.enterprise.ip}</th>
                <th className="px-2 py-1 text-start font-medium">{dict.enterprise.when}</th>
              </tr>
            </thead>
            <tbody className="text-ink-soft">
              {events.map((ev) => (
                <tr key={ev.id} className="border-t border-line align-top">
                  <td className="px-2 py-2">
                    <code className="text-xs text-ink" dir="ltr">
                      {ev.event}
                    </code>
                  </td>
                  <td className="px-2 py-2 text-xs" dir="ltr">
                    {ev.actorUserId ?? '—'}
                  </td>
                  <td className="px-2 py-2 text-xs" dir="ltr">
                    {ev.ip ?? '—'}
                  </td>
                  <td className="px-2 py-2 text-xs text-ink-faint">{fmt.format(new Date(ev.createdAt))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Security summary
// ---------------------------------------------------------------------------

function SecuritySection({ dict }: { dict: Dictionary }) {
  const [data, setData] = useState<PolicyResponse | null>(null);
  const [ssoConfigured, setSsoConfigured] = useState<boolean | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [polRes, idRes] = await Promise.all([
          fetch('/api/org/enterprise/security-policy', { cache: 'no-store' }),
          fetch('/api/org/enterprise/identity', { cache: 'no-store' }),
        ]);
        if (!polRes.ok) {
          if (alive) setNotice(noticeFor(polRes.status, dict));
          return;
        }
        const body: PolicyResponse = await polRes.json();
        if (alive) setData(body);
        if (idRes.ok) {
          const idBody = await idRes.json();
          const providers = Array.isArray(idBody.providers) ? idBody.providers : [];
          if (alive) setSsoConfigured(providers.some((p: IdentityProvider) => p.enabled));
        } else if (alive) {
          setSsoConfigured(false);
        }
      } catch {
        if (alive) setNotice(dict.enterprise.loadError);
      }
    })();
    return () => {
      alive = false;
    };
  }, [dict]);

  if (notice) {
    return (
      <div className="mt-4">
        <h2 className="text-sm font-semibold text-ink">{dict.enterprise.securityTitle}</h2>
        <SectionNotice tone="error">{notice}</SectionNotice>
      </div>
    );
  }
  if (!data) return <Loading />;

  const eff = data.effective;
  const bool = (v: unknown) => (v ? dict.enterprise.enabled : dict.enterprise.disabled);

  return (
    <div className="mt-4">
      <h2 className="text-sm font-semibold text-ink">{dict.enterprise.securityTitle}</h2>
      <p className="mt-1 text-sm text-ink-soft">{dict.enterprise.securityDesc}</p>

      <DeploymentBanner profile={data.deploymentProfile} dict={dict} />

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <InfoTile label={dict.enterprise.mfaRequired} value={bool(eff.mfaRequired ?? data.policy.mfaRequired)} />
        <InfoTile
          label={dict.enterprise.ssoStatus}
          value={
            ssoConfigured == null
              ? '—'
              : ssoConfigured
                ? dict.enterprise.configured
                : dict.enterprise.notConfigured
          }
        />
        <InfoTile
          label={dict.enterprise.marketplaceMode}
          value={marketModeLabel(String(eff.marketplaceMode ?? data.policy.marketplaceMode), dict)}
        />
        <InfoTile label={dict.enterprise.dataExportAllowed} value={bool(eff.dataExportAllowed ?? data.policy.dataExportAllowed)} />
        <InfoTile label={dict.enterprise.externalAIAllowed} value={bool(eff.externalAIAllowed ?? data.policy.externalAIAllowed)} />
        <InfoTile label={dict.enterprise.externalWritesEnabled} value={bool(eff.externalWritesEnabled ?? data.policy.externalWritesEnabled)} />
      </div>
    </div>
  );
}
