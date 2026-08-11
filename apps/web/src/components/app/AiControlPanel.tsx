'use client';

import { useCallback, useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { ROUTABLE_PERSONAS, WORKLOADS } from '@/config/ai-routing';

/** Shapes returned by GET /api/admin/ai/config (secrets already redacted). */
interface ModelRow {
  id: string;
  slug: string;
  displayName: string;
  providerSlug?: string;
  providerModelId: string;
  enabled: boolean;
  visibleToUsers: boolean;
  adminOnly: boolean;
  maintenanceMode: boolean;
  capabilities: Record<string, boolean>;
  priority: number;
}
interface ProviderRow {
  id: string;
  slug: string;
  displayName: string;
  type: string;
  enabled: boolean;
  maintenanceMode: boolean;
  healthState: string;
  priority: number;
  baseUrl: { envRef: string; configured: boolean } | null;
  apiKey: { envRef: string; configured: boolean } | null;
}
interface Catalog {
  settings: { defaultModelSlug: string | null; fallbackEnabled: boolean; fallbackModelSlug: string | null; maintenanceMode: boolean };
  providers: ProviderRow[];
  models: ModelRow[];
  routes: { persona: Record<string, string | null>; workload: Record<string, string | null>; plan: Record<string, string | null> };
  problems: string[];
  metrics: { requests: number; success: number; errors: number; failovers: number; avgLatencyMs: number; avgTtftMs: number; lastErrorCode?: string };
  audit: Array<{ id: string; action: string; targetType: string; targetId: string | null; createdAt: string }>;
}

const healthDot: Record<string, string> = { ok: 'bg-success', error: 'bg-danger', degraded: 'bg-gold', unknown: 'bg-line-strong' };

export function AiControlPanel() {
  const [data, setData] = useState<Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/admin/ai/config', { cache: 'no-store' });
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      setData(await res.json());
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = async (url: string, method: 'PATCH' | 'PUT', bodyObj: unknown) => {
    setBusy(true);
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodyObj) });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `Update failed (${res.status})`);
      }
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const updateModel = (id: string, body: Record<string, unknown>) => patch(`/api/admin/ai/models/${id}`, 'PATCH', body);
  const updateProvider = (id: string, body: Record<string, unknown>) => patch(`/api/admin/ai/providers/${id}`, 'PATCH', body);

  if (!data) {
    return (
      <div className="grid h-full place-items-center">
        {error ? <p className="text-sm text-danger">{error}</p> : <span className="h-6 w-6 animate-spin rounded-full border-2 border-line-strong border-t-accent" />}
      </div>
    );
  }

  const modelOptions = data.models.map((m) => ({ value: m.slug, label: `${m.displayName} (${m.slug})` }));

  return (
    <div className="scroll-slim h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-5 py-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ink">AI Control</h1>
            <p className="mt-1 text-sm text-ink-soft">Models, providers, and routing. Infrastructure detail is hidden from consumers.</p>
          </div>
          <button onClick={load} disabled={busy} className="btn-outline">
            <Icon name="regenerate" width={14} height={14} /> Refresh
          </button>
        </div>

        {error && <p className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
        {data.problems.length > 0 && (
          <div className="mt-4 rounded-xl border border-gold/40 bg-gold/10 p-4">
            <p className="text-sm font-semibold text-ink">Configuration warnings</p>
            <ul className="mt-1 list-inside list-disc text-sm text-ink-soft">
              {data.problems.map((p) => <li key={p}>{p}</li>)}
            </ul>
          </div>
        )}

        {/* Overview */}
        <Section title="Overview">
          <div className="grid gap-3 sm:grid-cols-4">
            <Tile label="Default model" value={data.settings.defaultModelSlug ?? '—'} />
            <Tile label="Requests" value={String(data.metrics.requests)} />
            <Tile label="Errors" value={String(data.metrics.errors)} />
            <Tile label="Avg latency" value={`${data.metrics.avgLatencyMs} ms`} />
          </div>
        </Section>

        {/* Providers */}
        <Section title="Providers">
          <div className="divide-y divide-line">
            {data.providers.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-3 py-3">
                <span className={`h-2.5 w-2.5 rounded-full ${healthDot[p.healthState] ?? 'bg-line-strong'}`} title={`health: ${p.healthState}`} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink">{p.displayName} <span className="text-xs text-ink-faint">({p.type})</span></p>
                  <p className="text-xs text-ink-faint">
                    {p.baseUrl ? `${p.baseUrl.envRef}: ${p.baseUrl.configured ? 'set' : 'not set'}` : 'no endpoint'}
                    {p.apiKey ? ` · ${p.apiKey.envRef}: ${p.apiKey.configured ? 'set' : 'not set'}` : ''}
                  </p>
                </div>
                <Toggle label="Enabled" checked={p.enabled} onChange={(v) => updateProvider(p.id, { enabled: v })} />
                <Toggle label="Maintenance" checked={p.maintenanceMode} onChange={(v) => updateProvider(p.id, { maintenanceMode: v })} />
              </div>
            ))}
          </div>
        </Section>

        {/* Models */}
        <Section title="Models">
          <div className="space-y-3">
            {data.models.map((m) => (
              <div key={m.id} className="rounded-xl border border-line p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold text-ink">{m.displayName} <span className="text-xs font-normal text-ink-faint">{m.slug}</span></p>
                    <p className="text-xs text-ink-faint">
                      via {m.providerSlug} · infra: {m.providerModelId} · priority {m.priority}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <Toggle label="Enabled" checked={m.enabled} onChange={(v) => updateModel(m.id, { enabled: v })} />
                    <Toggle label="Visible" checked={m.visibleToUsers} onChange={(v) => updateModel(m.id, { visibleToUsers: v })} />
                    <Toggle label="Maintenance" checked={m.maintenanceMode} onChange={(v) => updateModel(m.id, { maintenanceMode: v })} />
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {Object.entries(m.capabilities).filter(([, v]) => v).map(([k]) => (
                    <span key={k} className="rounded bg-paper-sunken px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ink-soft">{k}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* Routing */}
        <RoutingEditor data={data} modelOptions={modelOptions} busy={busy}
          onSave={(payload) => patch('/api/admin/ai/routing', 'PUT', payload)} />

        {/* Audit */}
        <Section title="Recent changes">
          {data.audit.length === 0 ? (
            <p className="text-sm text-ink-faint">No changes recorded yet.</p>
          ) : (
            <ul className="space-y-1 text-sm text-ink-soft">
              {data.audit.map((a) => (
                <li key={a.id} className="flex justify-between">
                  <span>{a.action} · {a.targetType}{a.targetId ? ` (${a.targetId})` : ''}</span>
                  <span className="text-ink-faint">{new Date(a.createdAt).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}

function RoutingEditor({
  data,
  modelOptions,
  busy,
  onSave,
}: {
  data: Catalog;
  modelOptions: Array<{ value: string; label: string }>;
  busy: boolean;
  onSave: (payload: Record<string, unknown>) => void;
}) {
  const [defaultModel, setDefaultModel] = useState(data.settings.defaultModelSlug ?? '');
  const [fallbackEnabled, setFallbackEnabled] = useState(data.settings.fallbackEnabled);
  const [fallbackModel, setFallbackModel] = useState(data.settings.fallbackModelSlug ?? '');
  const [persona, setPersona] = useState<Record<string, string>>(() => Object.fromEntries(ROUTABLE_PERSONAS.map((p) => [p, data.routes.persona[p] ?? ''])));
  const [workload, setWorkload] = useState<Record<string, string>>(() => Object.fromEntries(WORKLOADS.map((w) => [w, data.routes.workload[w] ?? ''])));

  const save = () => {
    const nullable = (v: string) => (v === '' ? null : v);
    onSave({
      defaultModelSlug: nullable(defaultModel),
      fallbackEnabled,
      fallbackModelSlug: nullable(fallbackModel),
      personaRoutes: Object.fromEntries(Object.entries(persona).map(([k, v]) => [k, nullable(v)])),
      workloadRoutes: Object.fromEntries(Object.entries(workload).map(([k, v]) => [k, nullable(v)])),
    });
  };

  return (
    <Section title="Routing">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Default model">
          <Select value={defaultModel} onChange={setDefaultModel} options={modelOptions} />
        </Field>
        <Field label="Fallback">
          <div className="flex items-center gap-2">
            <Toggle label="Enabled" checked={fallbackEnabled} onChange={setFallbackEnabled} />
            <Select value={fallbackModel} onChange={setFallbackModel} options={modelOptions} allowNone />
          </div>
        </Field>
      </div>

      <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-ink-faint">Persona → model</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {ROUTABLE_PERSONAS.map((p) => (
          <Field key={p} label={p}>
            <Select value={persona[p]} onChange={(v) => setPersona((s) => ({ ...s, [p]: v }))} options={modelOptions} allowNone />
          </Field>
        ))}
      </div>

      <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-ink-faint">Workload → model</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {WORKLOADS.map((w) => (
          <Field key={w} label={w}>
            <Select value={workload[w]} onChange={(v) => setWorkload((s) => ({ ...s, [w]: v }))} options={modelOptions} allowNone />
          </Field>
        ))}
      </div>

      <button onClick={save} disabled={busy} className="btn-primary mt-4">Save routing</button>
    </Section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card mt-4 p-5">
      <h2 className="mb-3 text-sm font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line p-4">
      <p className="truncate text-lg font-bold text-ink">{value}</p>
      <p className="mt-0.5 text-xs text-ink-soft">{label}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium capitalize text-ink-soft">{label}</span>
      {children}
    </label>
  );
}

function Select({
  value,
  onChange,
  options,
  allowNone,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  allowNone?: boolean;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="field">
      {allowNone && <option value="">— use default —</option>}
      {!allowNone && value === '' && <option value="">— select —</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-ink-soft">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-[rgb(var(--c-accent))]" />
      {label}
    </label>
  );
}
