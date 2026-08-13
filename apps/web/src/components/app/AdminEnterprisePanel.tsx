'use client';

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { Icon } from '@/components/Icon';

// ---- Types (mirror the API shapes; UI-only) ----

interface Flags {
  enterpriseFeatures: boolean;
  saml: boolean;
  scim: boolean;
  sovereignMode: boolean;
  dedicatedProviders: boolean;
}
interface Counts {
  organizations: number;
  identityProviders: number;
  verifiedDomains: number;
  privateProviders: number;
}
interface DeploymentProfile {
  id: string;
  slug: string;
  displayName: string;
  deploymentType: string;
  region?: string | null;
  jurisdictionLabel?: string | null;
  externalAIAllowed?: boolean;
  privateStorageRequired?: boolean;
  privateVectorStoreRequired?: boolean;
}
interface AdminEnterpriseData {
  flags: Flags;
  counts: Counts;
}
interface OrgOption {
  id: string;
  displayName: string;
  slug: string;
}

const DEPLOYMENT_TYPES = [
  'SHARED_SAAS',
  'DEDICATED_TENANT',
  'PRIVATE_CLOUD',
  'SOVEREIGN',
  'ON_PREMISE_READY',
] as const;

const PRIVILEGED_TYPES = new Set(['DEDICATED_TENANT', 'PRIVATE_CLOUD', 'SOVEREIGN']);

function deploymentTypeLabel(type: string, dict: Dictionary): string {
  const map: Record<string, string> = {
    SHARED_SAAS: dict.adminEnterprise.typeSharedSaas,
    DEDICATED_TENANT: dict.adminEnterprise.typeDedicated,
    PRIVATE_CLOUD: dict.adminEnterprise.typePrivateCloud,
    SOVEREIGN: dict.adminEnterprise.typeSovereign,
    ON_PREMISE_READY: dict.adminEnterprise.typeOnPremise,
  };
  return map[type] ?? type;
}

function FlagBadge({ on, label, dict }: { on: boolean; label: string; dict: Dictionary }) {
  return (
    <div className="card flex items-center justify-between p-4">
      <span className="text-sm font-medium text-ink">{label}</span>
      <span
        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
          on ? 'bg-success/15 text-success' : 'bg-paper-sunken text-ink-soft'
        }`}
      >
        {on ? dict.adminEnterprise.on : dict.adminEnterprise.off}
      </span>
    </div>
  );
}

function Banner({ tone, children }: { tone: 'ok' | 'error'; children: ReactNode }) {
  const cls = tone === 'ok' ? 'bg-success/15 text-success' : 'bg-danger/10 text-danger';
  return <p className={`mt-3 rounded-lg px-3 py-2 text-sm ${cls}`}>{children}</p>;
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

export function AdminEnterprisePanel({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const [data, setData] = useState<AdminEnterpriseData | null>(null);
  const [profiles, setProfiles] = useState<DeploymentProfile[]>([]);
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const num = new Intl.NumberFormat(locale === 'ar' ? 'ar-AE' : 'en-US');

  const loadProfiles = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/enterprise/deployment-profiles', { cache: 'no-store' });
      if (!res.ok) return;
      const body = await res.json();
      setProfiles(Array.isArray(body.profiles) ? body.profiles : []);
    } catch {
      /* non-fatal */
    }
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/admin/enterprise', { cache: 'no-store' });
      if (!res.ok) throw new Error();
      setData(await res.json());
    } catch {
      setError(dict.adminEnterprise.loadError);
    }
    void loadProfiles();
    try {
      const orgRes = await fetch('/api/admin/orgs', { cache: 'no-store' });
      if (orgRes.ok) {
        const body = await orgRes.json();
        setOrgs(Array.isArray(body.organizations) ? body.organizations : []);
      }
    } catch {
      /* non-fatal */
    }
  }, [dict, loadProfiles]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!data) {
    return (
      <div className="grid h-full place-items-center">
        {error ? (
          <p className="text-sm text-danger">{error}</p>
        ) : (
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-line-strong border-t-accent" />
        )}
      </div>
    );
  }

  const countTiles = [
    { label: dict.adminEnterprise.countOrgs, value: data.counts.organizations },
    { label: dict.adminEnterprise.countIdentity, value: data.counts.identityProviders },
    { label: dict.adminEnterprise.countDomains, value: data.counts.verifiedDomains },
    { label: dict.adminEnterprise.countPrivate, value: data.counts.privateProviders },
  ];

  return (
    <div className="scroll-slim h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-5 py-8">
        <h1 className="text-2xl font-bold tracking-tight text-ink">{dict.adminEnterprise.title}</h1>
        <p className="mt-1 text-sm text-ink-soft">{dict.adminEnterprise.subtitle}</p>

        {error && <Banner tone="error">{error}</Banner>}

        {/* Sovereign clarification note */}
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-gold/40 bg-gold/5 p-4 text-sm text-ink-soft">
          <Icon name="shield" width={18} height={18} className="mt-0.5 shrink-0 text-gold" />
          <span>{dict.adminEnterprise.sovereignNote}</span>
        </div>

        {/* Flags */}
        <h2 className="mt-6 text-sm font-semibold text-ink-soft">{dict.adminEnterprise.flags}</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <FlagBadge on={data.flags.enterpriseFeatures} label={dict.adminEnterprise.flagEnterprise} dict={dict} />
          <FlagBadge on={data.flags.saml} label={dict.adminEnterprise.flagSaml} dict={dict} />
          <FlagBadge on={data.flags.scim} label={dict.adminEnterprise.flagScim} dict={dict} />
          <FlagBadge on={data.flags.sovereignMode} label={dict.adminEnterprise.flagSovereign} dict={dict} />
          <FlagBadge on={data.flags.dedicatedProviders} label={dict.adminEnterprise.flagDedicated} dict={dict} />
        </div>

        {/* Counts */}
        <h2 className="mt-6 text-sm font-semibold text-ink-soft">{dict.adminEnterprise.counts}</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          {countTiles.map((t) => (
            <div key={t.label} className="card p-5">
              <p className="text-3xl font-bold text-ink">{num.format(t.value)}</p>
              <p className="mt-1 text-sm text-ink-soft">{t.label}</p>
            </div>
          ))}
        </div>

        {/* Deployment profiles */}
        <h2 className="mt-8 text-sm font-semibold text-ink-soft">{dict.adminEnterprise.profilesTitle}</h2>
        <p className="mt-1 text-sm text-ink-soft">{dict.adminEnterprise.profilesDesc}</p>

        {profiles.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-ink-faint">
            {dict.adminEnterprise.profilesEmpty}
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-start text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-ink-faint">
                  <th className="px-2 py-1 text-start font-medium">{dict.adminEnterprise.displayName}</th>
                  <th className="px-2 py-1 text-start font-medium">{dict.adminEnterprise.deploymentType}</th>
                  <th className="px-2 py-1 text-start font-medium">{dict.adminEnterprise.region}</th>
                  <th className="px-2 py-1 text-start font-medium">{dict.adminEnterprise.jurisdiction}</th>
                </tr>
              </thead>
              <tbody className="text-ink-soft">
                {profiles.map((p) => (
                  <tr key={p.id} className="border-t border-line align-top">
                    <td className="px-2 py-2">
                      <span className="flex items-center gap-2">
                        <span className="font-medium text-ink" dir="auto">
                          {p.displayName}
                        </span>
                        {PRIVILEGED_TYPES.has(p.deploymentType) && (
                          <span className="rounded-full bg-danger/10 px-2 py-0.5 text-[10px] font-semibold text-danger">
                            {dict.adminEnterprise.privilegedBadge}
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-ink-faint" dir="ltr">
                        {p.slug}
                      </span>
                    </td>
                    <td className="px-2 py-2">{deploymentTypeLabel(p.deploymentType, dict)}</td>
                    <td className="px-2 py-2">{p.region || '—'}</td>
                    <td className="px-2 py-2" dir="auto">
                      {p.jurisdictionLabel || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4">
          {showAdd ? (
            <CreateProfileForm
              dict={dict}
              onDone={() => {
                setShowAdd(false);
                void loadProfiles();
              }}
              onCancel={() => setShowAdd(false)}
            />
          ) : (
            <button type="button" onClick={() => setShowAdd(true)} className="btn-outline px-3 py-2 text-sm">
              <Icon name="plus" width={16} height={16} />
              {dict.adminEnterprise.createProfile}
            </button>
          )}
        </div>

        {/* Assign deployment */}
        <h2 className="mt-8 text-sm font-semibold text-ink-soft">{dict.adminEnterprise.assignTitle}</h2>
        <AssignDeployment dict={dict} orgs={orgs} profiles={profiles} />
      </div>
    </div>
  );
}

function CreateProfileForm({
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
      deploymentType: String(form.get('deploymentType') || 'SHARED_SAAS'),
      externalAIAllowed: form.get('externalAIAllowed') === 'on',
      externalWebSearchAllowed: form.get('externalWebSearchAllowed') === 'on',
      externalConnectorsAllowed: form.get('externalConnectorsAllowed') === 'on',
      privateStorageRequired: form.get('privateStorageRequired') === 'on',
      privateVectorStoreRequired: form.get('privateVectorStoreRequired') === 'on',
    };
    const region = String(form.get('region') || '').trim();
    const jurisdictionLabel = String(form.get('jurisdictionLabel') || '').trim();
    const allowedProviderRegions = String(form.get('allowedProviderRegions') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (region) body.region = region;
    if (jurisdictionLabel) body.jurisdictionLabel = jurisdictionLabel;
    if (allowedProviderRegions.length) body.allowedProviderRegions = allowedProviderRegions;
    try {
      const res = await fetch('/api/admin/enterprise/deployment-profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => null);
        setError((b && b.error) || dict.adminEnterprise.loadError);
        return;
      }
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-3 p-4">
      <h3 className="text-sm font-semibold text-ink">{dict.adminEnterprise.createProfile}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {labeledField('profSlug', dict.adminEnterprise.slug, <input id="profSlug" name="slug" className="field" required dir="ltr" />)}
        {labeledField(
          'profName',
          dict.adminEnterprise.displayName,
          <input id="profName" name="displayName" className="field" required dir="auto" />,
        )}
        {labeledField(
          'profType',
          dict.adminEnterprise.deploymentType,
          <select id="profType" name="deploymentType" className="field" defaultValue="SHARED_SAAS">
            {DEPLOYMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {deploymentTypeLabel(t, dict)}
              </option>
            ))}
          </select>,
        )}
        {labeledField('profRegion', dict.adminEnterprise.region, <input id="profRegion" name="region" className="field" dir="ltr" />)}
        {labeledField(
          'profJur',
          dict.adminEnterprise.jurisdiction,
          <input id="profJur" name="jurisdictionLabel" className="field" dir="auto" />,
        )}
        {labeledField(
          'profRegions',
          dict.adminEnterprise.allowedProviderRegions,
          <input id="profRegions" name="allowedProviderRegions" className="field" dir="ltr" />,
          dict.adminEnterprise.listHint,
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          <input type="checkbox" name="externalAIAllowed" className="h-4 w-4" />
          {dict.adminEnterprise.externalAIAllowed}
        </label>
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          <input type="checkbox" name="externalWebSearchAllowed" className="h-4 w-4" />
          {dict.adminEnterprise.externalWebSearchAllowed}
        </label>
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          <input type="checkbox" name="externalConnectorsAllowed" className="h-4 w-4" />
          {dict.adminEnterprise.externalConnectorsAllowed}
        </label>
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          <input type="checkbox" name="privateStorageRequired" className="h-4 w-4" />
          {dict.adminEnterprise.privateStorageRequired}
        </label>
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          <input type="checkbox" name="privateVectorStoreRequired" className="h-4 w-4" />
          {dict.adminEnterprise.privateVectorRequired}
        </label>
      </div>
      {error && <Banner tone="error">{error}</Banner>}
      <div className="flex items-center gap-2">
        <button type="submit" disabled={busy} className="btn-primary px-4 py-2 text-sm">
          {busy ? dict.adminEnterprise.creating : dict.adminEnterprise.create}
        </button>
        <button type="button" onClick={onCancel} className="btn-ghost px-3 py-2 text-sm">
          {dict.enterprise.cancel}
        </button>
      </div>
    </form>
  );
}

function AssignDeployment({
  dict,
  orgs,
  profiles,
}: {
  dict: Dictionary;
  orgs: OrgOption[];
  profiles: DeploymentProfile[];
}) {
  const [organizationId, setOrganizationId] = useState('');
  const [profileId, setProfileId] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function assign() {
    if (!organizationId) return;
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      const res = await fetch('/api/admin/enterprise/assign-deployment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId, profileId: profileId || null }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => null);
        setError((b && b.error) || dict.adminEnterprise.loadError);
        return;
      }
      setDone(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card mt-3 space-y-3 p-4">
      <p className="text-sm text-ink-soft">{dict.adminEnterprise.assignDesc}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {labeledField(
          'assignOrg',
          dict.adminEnterprise.organization,
          <select
            id="assignOrg"
            value={organizationId}
            onChange={(e) => {
              setOrganizationId(e.target.value);
              setDone(false);
            }}
            className="field"
          >
            <option value="">{dict.adminEnterprise.selectOrg}</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.displayName} ({o.slug})
              </option>
            ))}
          </select>,
        )}
        {labeledField(
          'assignProfile',
          dict.adminEnterprise.profile,
          <select
            id="assignProfile"
            value={profileId}
            onChange={(e) => {
              setProfileId(e.target.value);
              setDone(false);
            }}
            className="field"
          >
            <option value="">{dict.adminEnterprise.noProfile}</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))}
          </select>,
        )}
      </div>
      {error && <Banner tone="error">{error}</Banner>}
      {done && <Banner tone="ok">{dict.adminEnterprise.assigned}</Banner>}
      <button type="button" onClick={assign} disabled={busy || !organizationId} className="btn-primary px-4 py-2 text-sm">
        {busy ? dict.adminEnterprise.assigning : dict.adminEnterprise.assign}
      </button>
    </div>
  );
}
