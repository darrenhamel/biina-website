import { GatewayError } from '@biina/ai-gateway';
import type { AiModel, AiProvider } from '@/server/db/schema';
import type { AiConfigSnapshot } from './catalog';
import { modelById, modelBySlug, providerById } from './catalog';
import {
  WORKLOAD_REQUIREMENTS,
  isWorkload,
  type Capability,
  type Workload,
  type Plan,
} from '@/config/ai-routing';

/**
 * BIINA routing engine — decides WHERE a request goes (which BIINA model on which
 * provider). It is a PURE function over a config snapshot, so it is fully unit
 * testable without a database. The provider ROUTER (in @biina/ai-gateway) then
 * decides HOW to talk to that provider.
 *
 * Priority (highest first):
 *   1. explicit approved model override (user-selected, if allowed)
 *   2. persona route
 *   3. workload route
 *   4. plan route
 *   5. system default model
 *
 * Fail-safe: if no usable model can be found, throws GatewayError('invalid_config')
 * — surfaced to admins in logs; normal users get a generic 503.
 */

export interface RouteContext {
  userId?: string;
  userPlan?: Plan;
  isAdmin?: boolean;
  persona?: string | null;
  workload?: string | null;
  /** User-requested BIINA model slug (an approved logical id, never infra). */
  requestedModelSlug?: string | null;
  /** Extra required capabilities on top of the workload's. */
  requiredCapabilities?: Capability[];
}

export interface RouteDecision {
  model: AiModel;
  provider: AiProvider;
  providerType: AiProvider['type'];
  /** The vendor model id passed to the provider. */
  providerModel: string;
  biinaModelSlug: string;
  displayName: string;
  reason: string;
  fallbackUsed: boolean;
}

function requiredCaps(ctx: RouteContext): Capability[] {
  const base: Capability[] =
    ctx.workload && isWorkload(ctx.workload) ? WORKLOAD_REQUIREMENTS[ctx.workload as Workload] : ['chat', 'streaming'];
  return Array.from(new Set([...base, ...(ctx.requiredCapabilities ?? [])]));
}

/** Whether a model can serve a request (excludes health, which drives fallback). */
export function isModelUsable(
  model: AiModel | undefined,
  provider: AiProvider | undefined,
  caps: Capability[],
  opts: { isAdmin?: boolean; forOverride?: boolean } = {},
): boolean {
  if (!model || !provider) return false;
  if (!model.enabled || model.maintenanceMode) return false;
  if (!provider.enabled || provider.maintenanceMode) return false;
  for (const c of caps) {
    if (!model.capabilities?.[c]) return false;
  }
  if (opts.forOverride) {
    if (model.adminOnly && !opts.isAdmin) return false;
    if (!model.visibleToUsers && !opts.isAdmin) return false;
  }
  return true;
}

function toDecision(
  snap: AiConfigSnapshot,
  model: AiModel,
  reason: string,
  fallbackUsed = false,
): RouteDecision {
  const provider = providerById(snap, model.providerId)!;
  return {
    model,
    provider,
    providerType: provider.type,
    providerModel: model.providerModelId,
    biinaModelSlug: model.slug,
    displayName: model.displayName,
    reason,
    fallbackUsed,
  };
}

/** Ordered (model, reason) candidates by routing priority. */
function candidates(ctx: RouteContext, snap: AiConfigSnapshot): Array<{ model?: AiModel; reason: string; override?: boolean }> {
  const list: Array<{ model?: AiModel; reason: string; override?: boolean }> = [];
  if (ctx.requestedModelSlug) {
    list.push({ model: modelBySlug(snap, ctx.requestedModelSlug), reason: 'explicit model override', override: true });
  }
  if (ctx.persona && snap.routes.persona[ctx.persona]) {
    list.push({ model: modelById(snap, snap.routes.persona[ctx.persona]), reason: `persona:${ctx.persona}` });
  }
  if (ctx.workload && snap.routes.workload[ctx.workload]) {
    list.push({ model: modelById(snap, snap.routes.workload[ctx.workload]), reason: `workload:${ctx.workload}` });
  }
  if (ctx.userPlan && snap.routes.plan[ctx.userPlan]) {
    list.push({ model: modelById(snap, snap.routes.plan[ctx.userPlan]), reason: `plan:${ctx.userPlan}` });
  }
  list.push({ model: modelById(snap, snap.settings.defaultModelId), reason: 'default' });
  return list;
}

/** Resolve the primary route. Throws GatewayError('invalid_config') if none usable. */
export function selectRoute(ctx: RouteContext, snap: AiConfigSnapshot): RouteDecision {
  if (snap.settings.maintenanceMode) {
    throw new GatewayError('invalid_config', 'AI is in maintenance mode');
  }

  const caps = requiredCaps(ctx);
  const cands = candidates(ctx, snap);

  // An explicit override that is present-but-unusable is a hard, clear error
  // (the user asked for a specific model we can't honor).
  const override = cands.find((c) => c.override);
  if (override) {
    const p = providerById(snap, override.model?.providerId);
    if (!isModelUsable(override.model, p, caps, { isAdmin: ctx.isAdmin, forOverride: true })) {
      throw new GatewayError('invalid_config', 'Requested model is not available');
    }
    return toDecision(snap, override.model!, override.reason);
  }

  for (const c of cands) {
    const p = providerById(snap, c.model?.providerId);
    if (isModelUsable(c.model, p, caps)) {
      return toDecision(snap, c.model!, c.reason);
    }
  }

  throw new GatewayError('invalid_config', 'No usable model for this request');
}

/**
 * Resolve a fallback route (or null). Used when the primary provider is
 * unhealthy or fails before streaming. Loop-protected: the fallback must be a
 * DIFFERENT provider than the primary, usable, and not reference itself.
 */
export function selectFallback(
  snap: AiConfigSnapshot,
  primary: RouteDecision,
  ctx: RouteContext = {},
): RouteDecision | null {
  if (!snap.settings.fallbackEnabled) return null;
  const model = modelById(snap, snap.settings.fallbackModelId);
  if (!model) return null;
  if (model.id === primary.model.id) return null; // self-reference guard
  const provider = providerById(snap, model.providerId);
  if (!provider || provider.id === primary.provider.id) return null; // avoid same-provider loop
  const caps = requiredCaps(ctx);
  if (!isModelUsable(model, provider, caps)) return null;
  return toDecision(snap, model, `fallback:${primary.reason}`, true);
}

/**
 * Validate the whole configuration for the admin control page. Returns a list of
 * human-readable problems (empty = healthy). This is where fail-safe conditions
 * surface to administrators.
 */
export function validateConfig(snap: AiConfigSnapshot): string[] {
  const problems: string[] = [];
  const def = modelById(snap, snap.settings.defaultModelId);
  if (!snap.settings.defaultModelId) problems.push('No default model is set.');
  else if (!def) problems.push('Default model references a missing model.');
  else if (!def.enabled) problems.push(`Default model "${def.slug}" is disabled.`);
  else if (!providerById(snap, def.providerId)?.enabled)
    problems.push(`Default model "${def.slug}" uses a disabled provider.`);

  for (const [scope, map] of [
    ['persona', snap.routes.persona],
    ['workload', snap.routes.workload],
    ['plan', snap.routes.plan],
  ] as const) {
    for (const [key, modelId] of Object.entries(map)) {
      const m = modelById(snap, modelId);
      if (!m) problems.push(`${scope} route "${key}" references a missing model.`);
      else if (!m.enabled) problems.push(`${scope} route "${key}" -> disabled model "${m.slug}".`);
    }
  }

  if (snap.settings.fallbackEnabled) {
    if (!snap.settings.fallbackModelId) problems.push('Fallback is enabled but no fallback model is set.');
    else if (snap.settings.fallbackModelId === snap.settings.defaultModelId)
      problems.push('Fallback model is the same as the default model (fallback would be a no-op / loop).');
    else if (!modelById(snap, snap.settings.fallbackModelId))
      problems.push('Fallback references a missing model.');
  }
  return problems;
}
