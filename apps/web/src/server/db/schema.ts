import {
  pgTable,
  uuid,
  text,
  timestamp,
  varchar,
  index,
  pgEnum,
  jsonb,
  boolean,
  integer,
  bigint,
  real,
  unique,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

/**
 * BIINA.ai — Phase 1 schema.
 *
 * Intentionally lean: identity, sessions, profiles, conversations, messages, and
 * a small key/value app-settings table. Usage metering, plans, and the persisted
 * provider/model registry arrive in Phase 4 (see docs/ROADMAP.md) — we do NOT
 * build those tables yet.
 *
 * Design notes:
 *  - UUID primary keys (`gen_random_uuid()` — pgcrypto, available in Postgres 13+).
 *  - Roles kept minimal (USER / ADMIN); richer permissions come later.
 *  - `personaId` lives on the profile so persona-specific experiences can be
 *    introduced later without a schema change.
 *  - Message role is an enum shared conceptually with the AI gateway's ChatRole.
 */

// Platform role (distinct from ORGANIZATION role — see Phase 6 tables).
export const userRole = pgEnum('user_role', ['USER', 'ADMIN', 'SUPER_ADMIN']);
export const messageRole = pgEnum('message_role', ['user', 'assistant', 'system']);
// Plan tier — routing readiness (Phase 5 adds billing). Everyone is FREE for now.
export const userPlan = pgEnum('user_plan', ['FREE', 'PRO', 'BUSINESS', 'ENTERPRISE', 'ADMIN']);
// Account status — enforced server-side (Phase 6).
export const accountStatus = pgEnum('account_status', ['ACTIVE', 'SUSPENDED', 'DISABLED']);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 320 }).notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    role: userRole('role').notNull().default('USER'),
    plan: userPlan('plan').notNull().default('FREE'),
    // Phase 6 — identity hardening.
    status: accountStatus('status').notNull().default('ACTIVE'),
    emailVerified: boolean('email_verified').notNull().default(false),
    suspendedReason: varchar('suspended_reason', { length: 280 }),
    suspendedBy: uuid('suspended_by'),
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailIdx: index('users_email_idx').on(t.email),
    statusIdx: index('users_status_idx').on(t.status),
  }),
);

export const profiles = pgTable('profiles', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  displayName: varchar('display_name', { length: 120 }).notNull(),
  // Preferred UI locale: 'en' | 'ar' (validated in app code).
  locale: varchar('locale', { length: 8 }).notNull().default('en'),
  // Persona architecture hook — see src/config/personas.ts. Nullable = default experience.
  personaId: varchar('persona_id', { length: 32 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable(
  'sessions',
  {
    // The opaque token stored (hashed) — see auth layer. PK is the token id.
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    // Phase 6 — non-invasive session metadata for the security page.
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    userAgent: varchar('user_agent', { length: 400 }),
    ip: varchar('ip', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('sessions_user_idx').on(t.userId),
  }),
);

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Tenant owner. NULL = personal conversation; set = organization workspace.
    organizationId: uuid('organization_id'),
    title: varchar('title', { length: 200 }).notNull().default('New conversation'),
    // The logical model id last used (from the gateway registry). Not a vendor name.
    model: varchar('model', { length: 64 }),
    // Phase 8 — selected knowledge bases (verified server-side each request) + RAG mode.
    ragKnowledgeBaseIds: jsonb('rag_knowledge_base_ids').$type<string[]>(),
    ragMode: varchar('rag_mode', { length: 16 }), // 'off' | 'strict' | 'blended'
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('conversations_user_idx').on(t.userId),
    orgIdx: index('conversations_org_idx').on(t.organizationId),
    updatedIdx: index('conversations_updated_idx').on(t.updatedAt),
  }),
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: messageRole('role').notNull(),
    content: text('content').notNull(),
    // Provider/model that produced an assistant message (for transparency + Phase 4 metering).
    provider: varchar('provider', { length: 48 }),
    model: varchar('model', { length: 64 }),
    // Phase 8 — citation metadata for a RAG answer (source references, NOT content).
    citations: jsonb('citations').$type<
      Array<{ n: number; documentId: string; documentName: string; page?: number | null; sectionTitle?: string | null; chunkId: string; knowledgeBaseId: string }>
    >(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    convIdx: index('messages_conversation_idx').on(t.conversationId),
  }),
);

/** Small, typed key/value store for application-level settings (feature flags, etc.). */
export const appSettings = pgTable('app_settings', {
  key: varchar('key', { length: 96 }).primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---- Relations (for typed relational queries) ----

export const usersRelations = relations(users, ({ one, many }) => ({
  profile: one(profiles, { fields: [users.id], references: [profiles.userId] }),
  conversations: many(conversations),
  sessions: many(sessions),
}));

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  user: one(users, { fields: [conversations.userId], references: [users.id] }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
}));

// ==========================================================================
// Phase 4 — AI control plane (DB-backed model routing).
//
// SECRETS DO NOT LIVE HERE. Provider connection secrets (base URLs, API keys)
// stay in ENV; provider rows only carry NON-secret operational state (enabled,
// priority, health) plus the NAMES of the env vars that hold the secrets.
// ==========================================================================

export const providerType = pgEnum('ai_provider_type', ['mock', 'ollama', 'openai-compatible']);
export const healthStatus = pgEnum('ai_health_status', ['unknown', 'ok', 'degraded', 'error']);
export const routeScope = pgEnum('ai_route_scope', ['persona', 'workload', 'plan']);
// Phase 5 — metering enums.
export const costClass = pgEnum('ai_cost_class', ['VERY_LOW', 'LOW', 'MEDIUM', 'HIGH', 'PREMIUM']);
export const usageStatus = pgEnum('ai_usage_status', ['success', 'error', 'cancelled', 'timeout']);

/** Providers — infrastructure endpoints. No secrets stored; env holds those. */
export const aiProviders = pgTable('ai_providers', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: varchar('slug', { length: 64 }).notNull().unique(),
  displayName: varchar('display_name', { length: 120 }).notNull(),
  type: providerType('type').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  // Temporary operational disable, distinct from a permanent enabled=false.
  maintenanceMode: boolean('maintenance_mode').notNull().default(false),
  maintenanceNote: varchar('maintenance_note', { length: 280 }),
  healthState: healthStatus('health_state').notNull().default('unknown'),
  healthDetail: varchar('health_detail', { length: 280 }),
  healthCheckedAt: timestamp('health_checked_at', { withTimezone: true }),
  priority: integer('priority').notNull().default(100),
  // NON-secret references: the names of the env vars that carry the real values.
  baseUrlEnvRef: varchar('base_url_env_ref', { length: 96 }),
  apiKeyEnvRef: varchar('api_key_env_ref', { length: 96 }),
  // Optional future data-residency attributes (readiness only).
  region: varchar('region', { length: 32 }),
  supportsStreaming: boolean('supports_streaming').notNull().default(true),
  supportsChat: boolean('supports_chat').notNull().default(true),
  supportsTools: boolean('supports_tools').notNull().default(false),
  supportsVision: boolean('supports_vision').notNull().default(false),
  // Optional per-provider monthly internal-cost budget (readiness; not enforced yet).
  monthlyBudget: real('monthly_budget'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Models — logical BIINA identities mapped to a provider + a vendor model name. */
export const aiModels = pgTable(
  'ai_models',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Internal logical id (e.g. "biina-general-v1").
    slug: varchar('slug', { length: 64 }).notNull().unique(),
    // Consumer-facing name (e.g. "BIINA"). NEVER the infra model name.
    displayName: varchar('display_name', { length: 120 }).notNull(),
    description: varchar('description', { length: 280 }),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => aiProviders.id, { onDelete: 'restrict' }),
    // The provider's actual model identifier (e.g. "Qwen/Qwen2.5-7B-Instruct").
    providerModelId: varchar('provider_model_id', { length: 160 }).notNull(),
    enabled: boolean('enabled').notNull().default(true),
    visibleToUsers: boolean('visible_to_users').notNull().default(false),
    adminOnly: boolean('admin_only').notNull().default(false),
    maintenanceMode: boolean('maintenance_mode').notNull().default(false),
    maintenanceNote: varchar('maintenance_note', { length: 280 }),
    // Capability flags — routing rejects a route that can't satisfy requirements.
    capabilities: jsonb('capabilities')
      .notNull()
      .$type<Record<string, boolean>>()
      .default({ chat: true, streaming: true }),
    contextWindow: integer('context_window'),
    maxOutputTokens: integer('max_output_tokens'),
    priority: integer('priority').notNull().default(100),
    // Phase 4 readiness fields (retained for compatibility; superseded by the
    // Phase 5 cost model below).
    estimatedInputCost: real('estimated_input_cost'),
    estimatedOutputCost: real('estimated_output_cost'),
    infraCostClass: varchar('infra_cost_class', { length: 24 }),
    // Cost model (Phase 5) — internal estimates only, NEVER shown to users.
    // Token pricing is per 1,000,000 tokens; fixedRequestCost is per request.
    inputCostPerMillion: real('input_cost_per_million'),
    outputCostPerMillion: real('output_cost_per_million'),
    fixedRequestCost: real('fixed_request_cost'),
    costCurrency: varchar('cost_currency', { length: 8 }).notNull().default('USD'),
    // Qualitative class for GPU/self-hosted models where per-token cost is unknown.
    costClass: costClass('cost_class'),
    costSource: varchar('cost_source', { length: 64 }),
    costUpdatedAt: timestamp('cost_updated_at', { withTimezone: true }),
    // Optional per-model monthly internal-cost ceiling (readiness; not enforced yet).
    monthlyBudget: real('monthly_budget'),
    // Latency readiness (populated opportunistically from metrics).
    avgLatencyMs: integer('avg_latency_ms'),
    avgTtftMs: integer('avg_ttft_ms'),
    recentErrorRate: real('recent_error_rate'),
    // Sovereign/data-residency readiness (unused now).
    dataResidency: varchar('data_residency', { length: 32 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    providerIdx: index('ai_models_provider_idx').on(t.providerId),
  }),
);

/** Routing assignments: persona/workload/plan → model. Default lives in ai_settings. */
export const aiRoutes = pgTable(
  'ai_routes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    scope: routeScope('scope').notNull(),
    // e.g. persona 'kids', workload 'reasoning', plan 'FREE'.
    scopeKey: varchar('scope_key', { length: 48 }).notNull(),
    modelId: uuid('model_id')
      .notNull()
      .references(() => aiModels.id, { onDelete: 'cascade' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    scopeKeyUniq: unique('ai_routes_scope_key_uniq').on(t.scope, t.scopeKey),
  }),
);

/** Singleton control settings (id is always 'singleton'). */
export const aiSettings = pgTable('ai_settings', {
  id: varchar('id', { length: 16 }).primaryKey().default('singleton'),
  defaultModelId: uuid('default_model_id').references(() => aiModels.id, { onDelete: 'set null' }),
  fallbackEnabled: boolean('fallback_enabled').notNull().default(false),
  fallbackModelId: uuid('fallback_model_id').references(() => aiModels.id, { onDelete: 'set null' }),
  // Optional global maintenance switch (blocks all AI with a clear admin error).
  maintenanceMode: boolean('maintenance_mode').notNull().default(false),
  // Phase 5 — platform-wide budget controls (soft warnings + optional hard limit).
  currency: varchar('currency', { length: 8 }).notNull().default('USD'),
  dailyCostWarn: real('daily_cost_warn'),
  dailyCostHardLimit: real('daily_cost_hard_limit'),
  monthlyCostWarn: real('monthly_cost_warn'),
  monthlyCostHardLimit: real('monthly_cost_hard_limit'),
  // Hard limit is OFF unless explicitly enabled by an admin.
  hardLimitEnabled: boolean('hard_limit_enabled').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Audit trail of admin changes to AI configuration. No secrets recorded. */
export const aiAuditLog = pgTable(
  'ai_audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adminUserId: uuid('admin_user_id').references(() => users.id, { onDelete: 'set null' }),
    action: varchar('action', { length: 64 }).notNull(),
    targetType: varchar('target_type', { length: 32 }).notNull(),
    targetId: varchar('target_id', { length: 96 }),
    previousValue: jsonb('previous_value'),
    newValue: jsonb('new_value'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    createdIdx: index('ai_audit_created_idx').on(t.createdAt),
  }),
);

// ==========================================================================
// Phase 5 — usage metering, plans & cost controls.
//
// PRIVACY: the usage ledger NEVER stores prompt/response text — only accounting
// metadata keyed by requestId / conversationId. Accounting is separate from
// conversation content.
// ==========================================================================

/** Plan definitions — DB-backed entitlements (admin-editable). Not billing. */
export const plans = pgTable('plans', {
  // Matches the user_plan enum values: FREE / PRO / BUSINESS / ENTERPRISE / ADMIN.
  slug: varchar('slug', { length: 32 }).primaryKey(),
  displayName: varchar('display_name', { length: 80 }).notNull(),
  enabled: boolean('enabled').notNull().default(true),
  // Allowances — null means "no limit" for that dimension.
  dailyRequestLimit: integer('daily_request_limit'),
  monthlyRequestLimit: integer('monthly_request_limit'),
  dailyTokenLimit: integer('daily_token_limit'),
  monthlyTokenLimit: integer('monthly_token_limit'),
  requestsPerMinute: integer('requests_per_minute'),
  maxConcurrent: integer('max_concurrent'),
  maxContextTokens: integer('max_context_tokens'),
  maxOutputTokens: integer('max_output_tokens'),
  // Allow-lists (empty array = allow all). Slugs of models / workloads / personas.
  allowedModels: jsonb('allowed_models').notNull().$type<string[]>().default([]),
  allowedWorkloads: jsonb('allowed_workloads').notNull().$type<string[]>().default([]),
  allowedPersonas: jsonb('allowed_personas').notNull().$type<string[]>().default([]),
  // Feature eligibility (readiness; features arrive later).
  filesEligible: boolean('files_eligible').notNull().default(false),
  toolsEligible: boolean('tools_eligible').notNull().default(false),
  webSearchEligible: boolean('web_search_eligible').notNull().default(false),
  // Phase 8 — files / knowledge / RAG entitlements. null = unlimited for a limit.
  ragEnabled: boolean('rag_enabled').notNull().default(false),
  orgKnowledgeAccess: boolean('org_knowledge_access').notNull().default(false),
  maxFileSizeBytes: integer('max_file_size_bytes'),
  maxFiles: integer('max_files'),
  maxKnowledgeBases: integer('max_knowledge_bases'),
  storageBytesLimit: bigint('storage_bytes_limit', { mode: 'number' }),
  // Phase 9 — web search / live grounding. null = unlimited for a limit.
  webSearchEnabled: boolean('web_search_enabled').notNull().default(false),
  dailyWebSearches: integer('daily_web_searches'),
  monthlyWebSearches: integer('monthly_web_searches'),
  maxSourcesPerRequest: integer('max_sources_per_request'),
  freshnessFiltersEnabled: boolean('freshness_filters_enabled').notNull().default(false),
  // Phase 10 — connectors / external integrations. null = unlimited for a limit.
  connectorsEnabled: boolean('connectors_enabled').notNull().default(false),
  maxPersonalConnections: integer('max_personal_connections'),
  maxOrganizationConnections: integer('max_organization_connections'),
  connectedSearchDailyLimit: integer('connected_search_daily_limit'),
  connectedSearchMonthlyLimit: integer('connected_search_monthly_limit'),
  // Phase 11 — agent engine + safe tool execution. null = unlimited for a limit.
  agentEnabled: boolean('agent_enabled').notNull().default(false),
  agentSessionsDailyLimit: integer('agent_sessions_daily_limit'),
  agentSessionsMonthlyLimit: integer('agent_sessions_monthly_limit'),
  agentMaxStepsPerSession: integer('agent_max_steps_per_session'),
  agentWriteActionsDailyLimit: integer('agent_write_actions_daily_limit'),
  agentExternalMessagesDailyLimit: integer('agent_external_messages_daily_limit'),
  // Routing priority class (lower = higher priority). Readiness for priority routing.
  priorityClass: integer('priority_class').notNull().default(100),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Plan assignment history — supports trials / expiry / promotions (readiness). */
export const planAssignments = pgTable(
  'plan_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Nullable: an ORGANIZATION-scoped assignment has no individual user (Phase 7).
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    planSlug: varchar('plan_slug', { length: 32 }).notNull(),
    assignedBy: uuid('assigned_by').references(() => users.id, { onDelete: 'set null' }),
    note: varchar('note', { length: 200 }),
    // Where this entitlement came from — keeps PAID vs MANUAL vs TRIAL distinct
    // (Phase 7). DEFAULT/MANUAL/TRIAL/SUBSCRIPTION/ORGANIZATION/PROMOTION.
    source: varchar('source', { length: 24 }).notNull().$type<PlanSource>().default('MANUAL'),
    // Links a SUBSCRIPTION/TRIAL assignment back to the subscription that drives it.
    subscriptionId: uuid('subscription_id'),
    // Trial / subscription window readiness. endsAt = null means open-ended.
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull().defaultNow(),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    // Future org-level allowances.
    organizationId: uuid('organization_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('plan_assignments_user_idx').on(t.userId),
    sourceIdx: index('plan_assignments_source_idx').on(t.userId, t.source),
  }),
);

/** Where an entitlement came from — PAID subscriptions stay distinct from MANUAL grants. */
export type PlanSource = 'DEFAULT' | 'MANUAL' | 'TRIAL' | 'SUBSCRIPTION' | 'ORGANIZATION' | 'PROMOTION';

/**
 * Usage ledger — one row per AI request that reached a provider (success, error,
 * cancelled, or timeout). Idempotent on requestId. NO prompt/response text.
 */
export const usageEvents = pgTable(
  'usage_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id').notNull().unique(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    organizationId: uuid('organization_id'),
    conversationId: uuid('conversation_id'),
    // Logical BIINA model + resolved provider (non-secret identifiers).
    biinaModelSlug: varchar('biina_model_slug', { length: 64 }),
    providerType: varchar('provider_type', { length: 48 }),
    providerModelId: varchar('provider_model_id', { length: 160 }),
    persona: varchar('persona', { length: 32 }),
    workload: varchar('workload', { length: 32 }),
    plan: varchar('plan', { length: 32 }),
    // Token accounting (nullable — never invented when the provider omits them).
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    totalTokens: integer('total_tokens'),
    // Internal cost estimate (never provider-authoritative unless tokens are).
    estimatedInputCost: real('estimated_input_cost'),
    estimatedOutputCost: real('estimated_output_cost'),
    estimatedTotalCost: real('estimated_total_cost'),
    currency: varchar('currency', { length: 8 }).notNull().default('USD'),
    // Latency metrics.
    timeToFirstTokenMs: integer('ttft_ms'),
    generationMs: integer('generation_ms'),
    totalLatencyMs: integer('total_latency_ms'),
    // Fallback accounting.
    fallbackUsed: boolean('fallback_used').notNull().default(false),
    fallbackProviderType: varchar('fallback_provider_type', { length: 48 }),
    fallbackModelSlug: varchar('fallback_model_slug', { length: 64 }),
    // Per-provider-attempt operational costing (primary + fallback), no content.
    providerAttempts: jsonb('provider_attempts').$type<
      Array<{ providerType: string; providerModelId?: string; status: string; inputTokens?: number; outputTokens?: number; estimatedCost?: number }>
    >(),
    status: usageStatus('status').notNull(),
    failureCategory: varchar('failure_category', { length: 48 }),
    // Whether this event counted against the user's quota (provider failures don't).
    countedAgainstQuota: boolean('counted_against_quota').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => ({
    userCreatedIdx: index('usage_user_created_idx').on(t.userId, t.createdAt),
    providerCreatedIdx: index('usage_provider_created_idx').on(t.providerType, t.createdAt),
    modelCreatedIdx: index('usage_model_created_idx').on(t.biinaModelSlug, t.createdAt),
    planCreatedIdx: index('usage_plan_created_idx').on(t.plan, t.createdAt),
    statusIdx: index('usage_status_idx').on(t.status),
    createdIdx: index('usage_created_idx').on(t.createdAt),
  }),
);

export const aiModelsRelations = relations(aiModels, ({ one }) => ({
  provider: one(aiProviders, { fields: [aiModels.providerId], references: [aiProviders.id] }),
}));

// ==========================================================================
// Phase 6 — identity hardening + organizations (multi-tenant).
//
// PLATFORM roles (users.role) and ORGANIZATION roles (organization_members.role)
// are DISTINCT authorities and never share a column. Tokens are stored HASHED.
// ==========================================================================

export const orgStatus = pgEnum('org_status', ['ACTIVE', 'SUSPENDED']);
export const orgRole = pgEnum('org_role', ['OWNER', 'ADMIN', 'MEMBER']);
export const inviteStatus = pgEnum('invite_status', ['PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED']);
export const emailTokenType = pgEnum('email_token_type', ['verify', 'reset']);

/** Security event log — auth/identity events. NEVER stores passwords or tokens. */
export const securityEvents = pgTable(
  'security_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    actorUserId: uuid('actor_user_id'),
    organizationId: uuid('organization_id'),
    event: varchar('event', { length: 48 }).notNull(),
    ip: varchar('ip', { length: 64 }),
    userAgent: varchar('user_agent', { length: 400 }),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('security_events_user_idx').on(t.userId),
    createdIdx: index('security_events_created_idx').on(t.createdAt),
  }),
);

/** Single-use, hashed, expiring tokens for email verification + password reset. */
export const emailTokens = pgTable(
  'email_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: emailTokenType('type').notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('email_tokens_user_idx').on(t.userId),
  }),
);

/** Organizations — tenant boundary for businesses/schools/gov/enterprise. */
export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: varchar('slug', { length: 48 }).notNull().unique(),
    name: varchar('name', { length: 120 }).notNull(),
    displayName: varchar('display_name', { length: 120 }).notNull(),
    status: orgStatus('status').notNull().default('ACTIVE'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    // Org-level plan readiness (Phase 5 plans can later belong to an org).
    planSlug: varchar('plan_slug', { length: 32 }),
    // Seat/allowance readiness (not enforced yet).
    maxSeats: integer('max_seats'),
    suspendedReason: varchar('suspended_reason', { length: 280 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    slugIdx: index('organizations_slug_idx').on(t.slug),
    statusIdx: index('organizations_status_idx').on(t.status),
  }),
);

/** Organization membership — one row per (org, user). Carries the ORG role. */
export const organizationMembers = pgTable(
  'organization_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: orgRole('role').notNull().default('MEMBER'),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgUserUniq: unique('org_members_org_user_uniq').on(t.organizationId, t.userId),
    orgIdx: index('org_members_org_idx').on(t.organizationId),
    userIdx: index('org_members_user_idx').on(t.userId),
  }),
);

/** Organization invitations — hashed, single-use, expiring tokens. */
export const organizationInvitations = pgTable(
  'organization_invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    email: varchar('email', { length: 320 }).notNull(),
    role: orgRole('role').notNull().default('MEMBER'),
    tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
    status: inviteStatus('status').notNull().default('PENDING'),
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    acceptedBy: uuid('accepted_by').references(() => users.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  },
  (t) => ({
    orgIdx: index('org_invites_org_idx').on(t.organizationId),
    emailIdx: index('org_invites_email_idx').on(t.email),
  }),
);

export const organizationsRelations = relations(organizations, ({ many }) => ({
  members: many(organizationMembers),
}));
export const organizationMembersRelations = relations(organizationMembers, ({ one }) => ({
  organization: one(organizations, { fields: [organizationMembers.organizationId], references: [organizations.id] }),
  user: one(users, { fields: [organizationMembers.userId], references: [users.id] }),
}));

// ==========================================================================
// Phase 7 — payments, subscriptions & commercial plans.
//
// SEPARATION OF CONCERNS: a BIINA `plan` (FREE/PRO/…) is the business-domain
// entitlement (above). A `commercial_price` is a sellable offering with a
// PROVIDER price id. The app NEVER treats a provider price id as a plan id, and
// entitlements are only ever granted from webhook-verified provider state.
// No card data is ever stored here.
// ==========================================================================

export const billingProviderEnum = pgEnum('billing_provider', ['stripe']);
export const billingInterval = pgEnum('billing_interval', ['month', 'year']);
export const subscriptionStatus = pgEnum('subscription_status', [
  'TRIALING',
  'ACTIVE',
  'PAST_DUE',
  'CANCELED',
  'INCOMPLETE',
  'UNPAID',
  'PAUSED',
]);
export const webhookStatus = pgEnum('billing_webhook_status', ['received', 'processed', 'failed']);

/**
 * Commercial offering: maps a BIINA plan to a provider price. One plan may have
 * many prices (monthly/annual, AED/USD). `amount` is in the currency's minor
 * unit (fils/cents). Entitlements come from the plan, never from here.
 */
export const commercialPrices = pgTable(
  'commercial_prices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    planSlug: varchar('plan_slug', { length: 32 }).notNull(),
    displayName: varchar('display_name', { length: 120 }).notNull(),
    billingProvider: billingProviderEnum('billing_provider').notNull().default('stripe'),
    // The provider's price id (e.g. Stripe price_...). NON-secret, but never a plan id.
    providerPriceId: varchar('provider_price_id', { length: 255 }).notNull(),
    currency: varchar('currency', { length: 8 }).notNull(),
    amount: integer('amount').notNull(), // minor units
    billingInterval: billingInterval('billing_interval').notNull().default('month'),
    billingIntervalCount: integer('billing_interval_count').notNull().default(1),
    // Trial length offered with this price (days); null = no trial.
    trialDays: integer('trial_days'),
    // Seat readiness (Business).
    includedSeats: integer('included_seats'),
    maxSeats: integer('max_seats'),
    perSeatBilling: boolean('per_seat_billing').notNull().default(false),
    enabled: boolean('enabled').notNull().default(true),
    publiclyAvailable: boolean('publicly_available').notNull().default(true),
    // Clearly flag non-production placeholder pricing.
    isTest: boolean('is_test').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    planIdx: index('commercial_prices_plan_idx').on(t.planSlug),
    providerPriceUniq: unique('commercial_prices_provider_price_uniq').on(t.billingProvider, t.providerPriceId),
  }),
);

/**
 * Internal billing customer — maps a BIINA user OR organization to a provider
 * customer. Avoids creating duplicate provider customers. No card data.
 */
export const billingCustomers = pgTable(
  'billing_customers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'set null' }),
    billingProvider: billingProviderEnum('billing_provider').notNull().default('stripe'),
    providerCustomerId: varchar('provider_customer_id', { length: 255 }).notNull(),
    email: varchar('email', { length: 320 }),
    billingName: varchar('billing_name', { length: 200 }),
    billingCountry: varchar('billing_country', { length: 2 }),
    // Tax readiness (configurable, never assumed).
    taxRegistrationNumber: varchar('tax_registration_number', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    providerCustomerUniq: unique('billing_customers_provider_customer_uniq').on(t.billingProvider, t.providerCustomerId),
    userIdx: index('billing_customers_user_idx').on(t.userId),
    orgIdx: index('billing_customers_org_idx').on(t.organizationId),
  }),
);

/** Internal subscription record — synchronized carefully with provider state. */
export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'set null' }),
    planSlug: varchar('plan_slug', { length: 32 }).notNull(),
    commercialPriceId: uuid('commercial_price_id'),
    billingProvider: billingProviderEnum('billing_provider').notNull().default('stripe'),
    providerCustomerId: varchar('provider_customer_id', { length: 255 }),
    providerSubscriptionId: varchar('provider_subscription_id', { length: 255 }).notNull().unique(),
    status: subscriptionStatus('status').notNull(),
    currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    canceledAt: timestamp('canceled_at', { withTimezone: true }),
    trialStart: timestamp('trial_start', { withTimezone: true }),
    trialEnd: timestamp('trial_end', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('subscriptions_user_idx').on(t.userId),
    orgIdx: index('subscriptions_org_idx').on(t.organizationId),
    statusIdx: index('subscriptions_status_idx').on(t.status),
  }),
);

/** Safe references to provider invoices — never card data. */
export const billingInvoices = pgTable(
  'billing_invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subscriptionId: uuid('subscription_id'),
    billingCustomerId: uuid('billing_customer_id'),
    billingProvider: billingProviderEnum('billing_provider').notNull().default('stripe'),
    providerInvoiceId: varchar('provider_invoice_id', { length: 255 }).notNull().unique(),
    status: varchar('status', { length: 32 }),
    currency: varchar('currency', { length: 8 }),
    subtotal: integer('subtotal'),
    tax: integer('tax'),
    total: integer('total'),
    periodStart: timestamp('period_start', { withTimezone: true }),
    periodEnd: timestamp('period_end', { withTimezone: true }),
    invoiceUrl: text('invoice_url'),
    invoicePdfUrl: text('invoice_pdf_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    subIdx: index('billing_invoices_sub_idx').on(t.subscriptionId),
    customerIdx: index('billing_invoices_customer_idx').on(t.billingCustomerId),
  }),
);

/** Webhook event ledger — idempotency (unique on provider event id). */
export const billingWebhookEvents = pgTable(
  'billing_webhook_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    billingProvider: billingProviderEnum('billing_provider').notNull().default('stripe'),
    providerEventId: varchar('provider_event_id', { length: 255 }).notNull().unique(),
    eventType: varchar('event_type', { length: 120 }).notNull(),
    status: webhookStatus('status').notNull().default('received'),
    error: text('error'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
);

/**
 * Billing configuration singleton — non-secret commercial/tax settings that
 * admins may edit. Secrets (provider keys) live ONLY in env, never here.
 */
export const billingConfig = pgTable('billing_config', {
  id: varchar('id', { length: 16 }).primaryKey().default('singleton'),
  defaultCurrency: varchar('default_currency', { length: 8 }).notNull().default('AED'),
  // Tax config layer — configurable, never assumed correct.
  taxEnabled: boolean('tax_enabled').notNull().default(false),
  taxMode: varchar('tax_mode', { length: 24 }).notNull().default('none'), // none | inclusive | exclusive
  taxInclusive: boolean('tax_inclusive').notNull().default(false),
  taxRegistrationNumber: varchar('tax_registration_number', { length: 64 }),
  taxRateReference: varchar('tax_rate_reference', { length: 120 }),
  // Legal entity readiness (UAE-first).
  legalEntityName: varchar('legal_entity_name', { length: 200 }),
  billingCountry: varchar('billing_country', { length: 2 }).default('AE'),
  supportEmail: varchar('support_email', { length: 320 }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type CommercialPrice = typeof commercialPrices.$inferSelect;
export type BillingCustomer = typeof billingCustomers.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type BillingInvoice = typeof billingInvoices.$inferSelect;
export type BillingWebhookEvent = typeof billingWebhookEvents.$inferSelect;
export type BillingConfig = typeof billingConfig.$inferSelect;
export type SubscriptionStatus = (typeof subscriptionStatus.enumValues)[number];

// ==========================================================================
// Phase 8 — files, knowledge bases, document chunks & RAG.
//
// TENANT ISOLATION: every file / knowledge base / chunk carries its trusted
// owner scope (ownerUserId XOR organizationId). Retrieval ALWAYS filters by that
// scope in SQL — never a global search filtered afterward. Chunks store which
// embedding model produced their vector so a future re-embed is possible.
// ==========================================================================

export const fileStatus = pgEnum('file_status', ['UPLOADED', 'QUEUED', 'PROCESSING', 'READY', 'FAILED', 'DELETED', 'UNSUPPORTED']);
export const kbStatus = pgEnum('kb_status', ['ACTIVE', 'ARCHIVED']);
export const chunkEmbedStatus = pgEnum('chunk_embed_status', ['PENDING', 'EMBEDDED', 'FAILED']);

/** A knowledge base groups documents. Owned by a user XOR an organization. */
export const knowledgeBases = pgTable(
  'knowledge_bases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 160 }).notNull(),
    description: varchar('description', { length: 500 }),
    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    status: kbStatus('status').notNull().default('ACTIVE'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    ownerIdx: index('kb_owner_idx').on(t.ownerUserId),
    orgIdx: index('kb_org_idx').on(t.organizationId),
  }),
);

/** An uploaded document. Belongs to one knowledge base (MVP). No public paths. */
export const files = pgTable(
  'files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Trusted owner scope — exactly one of these is set.
    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
    uploadedByUserId: uuid('uploaded_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    knowledgeBaseId: uuid('knowledge_base_id').references(() => knowledgeBases.id, { onDelete: 'cascade' }),
    originalFilename: varchar('original_filename', { length: 400 }).notNull(),
    displayName: varchar('display_name', { length: 400 }).notNull(),
    mimeType: varchar('mime_type', { length: 160 }).notNull(),
    extension: varchar('extension', { length: 16 }).notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    storageProvider: varchar('storage_provider', { length: 32 }).notNull(),
    // Server-controlled internal key — NEVER a user filename, never exposed to users.
    storageKey: varchar('storage_key', { length: 400 }).notNull(),
    status: fileStatus('status').notNull().default('UPLOADED'),
    failureReason: varchar('failure_reason', { length: 500 }),
    pageCount: integer('page_count'),
    chunkCount: integer('chunk_count'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    ownerIdx: index('files_owner_idx').on(t.ownerUserId),
    orgIdx: index('files_org_idx').on(t.organizationId),
    kbIdx: index('files_kb_idx').on(t.knowledgeBaseId),
    statusIdx: index('files_status_idx').on(t.status),
    createdIdx: index('files_created_idx').on(t.createdAt),
  }),
);

/**
 * A retrievable chunk of a document. `embedding` is stored PORTABLY as a JSON
 * float array (works without pgvector); a pgvector deployment adds a `vector`
 * column + ANN index (see docs/VECTOR_STORAGE.md). `embeddingModel`/`embeddingDim`
 * record which model produced the vector, so a re-embed can detect mismatches.
 */
export const documentChunks = pgTable(
  'document_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    knowledgeBaseId: uuid('knowledge_base_id')
      .notNull()
      .references(() => knowledgeBases.id, { onDelete: 'cascade' }),
    // Denormalized trusted scope so retrieval filters isolation IN the query.
    organizationId: uuid('organization_id'),
    ownerUserId: uuid('owner_user_id'),
    chunkIndex: integer('chunk_index').notNull(),
    content: text('content').notNull(),
    pageNumber: integer('page_number'),
    sectionTitle: varchar('section_title', { length: 300 }),
    tokenCount: integer('token_count'),
    embeddingStatus: chunkEmbedStatus('embedding_status').notNull().default('PENDING'),
    embeddingModel: varchar('embedding_model', { length: 120 }),
    embeddingDim: integer('embedding_dim'),
    embedding: jsonb('embedding').$type<number[]>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    docIdx: index('chunks_document_idx').on(t.documentId),
    kbIdx: index('chunks_kb_idx').on(t.knowledgeBaseId),
    orgIdx: index('chunks_org_idx').on(t.organizationId),
    ownerIdx: index('chunks_owner_idx').on(t.ownerUserId),
    embedStatusIdx: index('chunks_embed_status_idx').on(t.embeddingStatus),
  }),
);

/** Retrieval audit/debug record — references + scores, never duplicated content. */
export const ragRequests = pgTable(
  'rag_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id'),
    userId: uuid('user_id'),
    organizationId: uuid('organization_id'),
    conversationId: uuid('conversation_id'),
    knowledgeBaseIds: jsonb('knowledge_base_ids').$type<string[]>(),
    retrievedChunkIds: jsonb('retrieved_chunk_ids').$type<string[]>(),
    scores: jsonb('scores').$type<number[]>(),
    resultCount: integer('result_count'),
    retrievalMs: integer('retrieval_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('rag_requests_user_idx').on(t.userId),
    createdIdx: index('rag_requests_created_idx').on(t.createdAt),
  }),
);

export type KnowledgeBase = typeof knowledgeBases.$inferSelect;
export type FileRecord = typeof files.$inferSelect;
export type DocumentChunk = typeof documentChunks.$inferSelect;
export type NewDocumentChunk = typeof documentChunks.$inferInsert;
export type RagRequest = typeof ragRequests.$inferSelect;

// ==========================================================================
// Phase 9 — web search & live information grounding.
//
// All public-web access goes through Biina.ai server components (never the LLM
// or a provider directly). This record is operational metadata only; retention
// of the raw query is minimized (redaction-ready).
// ==========================================================================

export const webSearchStatus = pgEnum('web_search_status', ['ok', 'no_results', 'error']);

export const webSearchRequests = pgTable(
  'web_search_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id'),
    userId: uuid('user_id'),
    organizationId: uuid('organization_id'),
    conversationId: uuid('conversation_id'),
    // Query is retained for debugging; a redaction/minimization policy can null it.
    query: varchar('query', { length: 500 }),
    provider: varchar('provider', { length: 48 }),
    mode: varchar('mode', { length: 24 }),
    resultCount: integer('result_count'),
    pagesFetched: integer('pages_fetched'),
    bytesFetched: integer('bytes_fetched'),
    fetchFailures: integer('fetch_failures'),
    status: webSearchStatus('status').notNull().default('ok'),
    searchLatencyMs: integer('search_latency_ms'),
    fetchLatencyMs: integer('fetch_latency_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('web_search_user_idx').on(t.userId),
    createdIdx: index('web_search_created_idx').on(t.createdAt),
  }),
);

export type WebSearchRequest = typeof webSearchRequests.$inferSelect;

// ==========================================================================
// Phase 10 — connectors & external application integrations.
//
// STRICT SEPARATION: a connector DEFINITION (registry metadata, no secrets) vs a
// CONNECTION (a user's or org's linked account) vs an encrypted CREDENTIAL (token
// set, server-only, never serialized). OAuth state is single-use + bound to the
// initiating identity. Personal and organization connections are distinct
// security domains and never bleed across tenants.
// ==========================================================================

export const connectionType = pgEnum('connection_type', ['PERSONAL', 'ORGANIZATION']);
export const connectionStatus = pgEnum('connection_status', ['PENDING', 'ACTIVE', 'EXPIRED', 'REAUTH_REQUIRED', 'REVOKED', 'ERROR', 'DISABLED']);

/** Connector registry — safe metadata only. NEVER holds provider secrets. */
export const connectorDefinitions = pgTable('connector_definitions', {
  slug: varchar('slug', { length: 48 }).primaryKey(),
  displayName: varchar('display_name', { length: 120 }).notNull(),
  providerType: varchar('provider_type', { length: 48 }).notNull(), // google | microsoft | slack | mock | ...
  category: varchar('category', { length: 32 }).notNull(),
  enabled: boolean('enabled').notNull().default(false),
  supportsOAuth: boolean('supports_oauth').notNull().default(true),
  supportsApiKey: boolean('supports_api_key').notNull().default(false),
  supportsPersonal: boolean('supports_personal').notNull().default(true),
  supportsOrganization: boolean('supports_organization').notNull().default(false),
  capabilities: jsonb('capabilities').notNull().$type<string[]>().default([]),
  scopes: jsonb('scopes').notNull().$type<string[]>().default([]),
  documentationUrl: varchar('documentation_url', { length: 300 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** A linked external account (personal XOR organization). No tokens here. */
export const connections = pgTable(
  'connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    connectorSlug: varchar('connector_slug', { length: 48 }).notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
    connectionType: connectionType('connection_type').notNull(),
    externalAccountId: varchar('external_account_id', { length: 255 }),
    externalAccountEmail: varchar('external_account_email', { length: 320 }),
    externalAccountName: varchar('external_account_name', { length: 200 }),
    status: connectionStatus('status').notNull().default('PENDING'),
    grantedScopes: jsonb('granted_scopes').$type<string[]>().default([]),
    capabilities: jsonb('capabilities').$type<string[]>().default([]),
    error: varchar('error', { length: 300 }),
    connectedByUserId: uuid('connected_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    connectedAt: timestamp('connected_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('connections_user_idx').on(t.userId),
    orgIdx: index('connections_org_idx').on(t.organizationId),
    connectorIdx: index('connections_connector_idx').on(t.connectorSlug),
    statusIdx: index('connections_status_idx').on(t.status),
  }),
);

/** Encrypted credential (OAuth token set / API key). Server-only, never serialized. */
export const connectorCredentials = pgTable('connector_credentials', {
  id: uuid('id').primaryKey().defaultRandom(),
  connectionId: uuid('connection_id')
    .notNull()
    .unique()
    .references(() => connections.id, { onDelete: 'cascade' }),
  // AES-256-GCM ciphertext (iv:tag:data, base64). Decryptable only server-side.
  ciphertext: text('ciphertext').notNull(),
  keyVersion: integer('key_version').notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Single-use OAuth state, bound to the initiating identity + connector. */
export const oauthStates = pgTable(
  'oauth_states',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    state: varchar('state', { length: 96 }).notNull().unique(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    connectorSlug: varchar('connector_slug', { length: 48 }).notNull(),
    connectionType: connectionType('connection_type').notNull(),
    organizationId: uuid('organization_id'),
    codeVerifier: varchar('code_verifier', { length: 128 }), // PKCE
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ expiresIdx: index('oauth_states_expires_idx').on(t.expiresAt) }),
);

/** Connector operation metering — metadata only, never external content. */
export const connectorUsageEvents = pgTable(
  'connector_usage_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    connectorSlug: varchar('connector_slug', { length: 48 }).notNull(),
    operation: varchar('operation', { length: 48 }).notNull(),
    connectionId: uuid('connection_id'),
    userId: uuid('user_id'),
    organizationId: uuid('organization_id'),
    resourceType: varchar('resource_type', { length: 32 }),
    success: boolean('success').notNull(),
    errorCode: varchar('error_code', { length: 48 }),
    latencyMs: integer('latency_ms'),
    requestId: uuid('request_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('connector_usage_user_idx').on(t.userId),
    createdIdx: index('connector_usage_created_idx').on(t.createdAt),
  }),
);

export type ConnectorDefinition = typeof connectorDefinitions.$inferSelect;
export type Connection = typeof connections.$inferSelect;
export type ConnectorCredential = typeof connectorCredentials.$inferSelect;
export type OAuthState = typeof oauthStates.$inferSelect;
export type ConnectorUsageEvent = typeof connectorUsageEvents.$inferSelect;

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Profile = typeof profiles.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type AiProvider = typeof aiProviders.$inferSelect;
export type AiModel = typeof aiModels.$inferSelect;
export type AiRoute = typeof aiRoutes.$inferSelect;
export type AiSettings = typeof aiSettings.$inferSelect;
export type Plan = typeof plans.$inferSelect;
export type PlanAssignment = typeof planAssignments.$inferSelect;
export type UsageEvent = typeof usageEvents.$inferSelect;
export type NewUsageEvent = typeof usageEvents.$inferInsert;
export type Organization = typeof organizations.$inferSelect;
export type OrganizationMember = typeof organizationMembers.$inferSelect;
export type OrganizationInvitation = typeof organizationInvitations.$inferSelect;
export type SecurityEvent = typeof securityEvents.$inferSelect;
export type EmailToken = typeof emailTokens.$inferSelect;

// ==========================================================================
// Phase 11 — agent engine + safe tool execution.
//
// SAFETY MODEL: the model may PROPOSE / PLAN / SELECT / REQUEST; BIINA controls
// AUTHORIZE / CONFIRM / EXECUTE / LIMIT / AUDIT. The model is NEVER the final
// authority on whether an action runs. We store OPERATIONAL steps only — never
// hidden model chain-of-thought. External writes are bound to a single-use,
// expiring approval whose hash pins the exact normalized arguments.
// ==========================================================================

export const agentMode = pgEnum('agent_mode', ['CHAT', 'ASSISTED', 'AGENT']);
export const agentSessionStatus = pgEnum('agent_session_status', ['PENDING', 'RUNNING', 'AWAITING_APPROVAL', 'COMPLETED', 'FAILED', 'CANCELED', 'BLOCKED']);
export const agentStepStatus = pgEnum('agent_step_status', ['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED']);
export const agentActionStatus = pgEnum('agent_action_status', ['PROPOSED', 'AWAITING_APPROVAL', 'APPROVED', 'EXECUTING', 'SUCCEEDED', 'FAILED', 'REJECTED', 'CANCELED', 'BLOCKED', 'EXPIRED', 'UNKNOWN_OUTCOME']);
export const approvalStatus = pgEnum('approval_status', ['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CONSUMED']);
export const agentPolicyScope = pgEnum('agent_policy_scope', ['PLATFORM', 'ORGANIZATION', 'USER']);

/** An agent run: a bounded, human-supervised attempt at a user goal. */
export const agentSessions = pgTable(
  'agent_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id'),
    mode: agentMode('mode').notNull().default('ASSISTED'),
    status: agentSessionStatus('status').notNull().default('PENDING'),
    // The normalized user goal (objective + server-derived constraints). No secrets.
    goal: text('goal').notNull(),
    plan: jsonb('plan').$type<string[]>().default([]), // concise user-facing steps (NOT chain-of-thought)
    maxSteps: integer('max_steps').notNull().default(8),
    stepsUsed: integer('steps_used').notNull().default(0),
    toolCallsUsed: integer('tool_calls_used').notNull().default(0),
    writeActionsUsed: integer('write_actions_used').notNull().default(0),
    // Cost/usage accounting (estimated). Aggregated from LLM + tool operations.
    estimatedCost: real('estimated_cost').notNull().default(0),
    costBudget: real('cost_budget'), // null = plan/default budget
    currency: varchar('currency', { length: 8 }).notNull().default('USD'),
    dryRun: boolean('dry_run').notNull().default(false),
    error: varchar('error', { length: 300 }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    canceledAt: timestamp('canceled_at', { withTimezone: true }),
    deadlineAt: timestamp('deadline_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('agent_sessions_user_idx').on(t.userId),
    orgIdx: index('agent_sessions_org_idx').on(t.organizationId),
    statusIdx: index('agent_sessions_status_idx').on(t.status),
    createdIdx: index('agent_sessions_created_idx').on(t.createdAt),
  }),
);

/** One operational step in an agent run. Structured summaries only — no reasoning. */
export const agentSteps = pgTable(
  'agent_steps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentSessionId: uuid('agent_session_id').notNull().references(() => agentSessions.id, { onDelete: 'cascade' }),
    stepIndex: integer('step_index').notNull(),
    stepType: varchar('step_type', { length: 32 }).notNull(), // PLAN | TOOL_READ | TOOL_WRITE | VERIFY | RESPOND | BLOCKED
    toolId: varchar('tool_id', { length: 64 }),
    actionId: uuid('action_id'),
    status: agentStepStatus('status').notNull().default('PENDING'),
    inputSummary: varchar('input_summary', { length: 500 }),
    outputSummary: varchar('output_summary', { length: 1000 }),
    requestId: uuid('request_id'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    sessionIdx: index('agent_steps_session_idx').on(t.agentSessionId),
  }),
);

/** A concrete tool action proposed by the agent. Write actions carry an arguments hash. */
export const agentActions = pgTable(
  'agent_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentSessionId: uuid('agent_session_id').notNull().references(() => agentSessions.id, { onDelete: 'cascade' }),
    agentStepId: uuid('agent_step_id'),
    toolId: varchar('tool_id', { length: 64 }).notNull(),
    connectionId: uuid('connection_id'),
    riskLevel: varchar('risk_level', { length: 32 }).notNull(),
    reversibility: varchar('reversibility', { length: 24 }).notNull().default('IRREVERSIBLE'),
    approvalStatus: varchar('approval_status', { length: 24 }).notNull().default('NOT_REQUIRED'),
    // Normalized (validated) arguments. Sensitive fields are redacted before storage.
    normalizedArguments: jsonb('normalized_arguments'),
    argumentsHash: varchar('arguments_hash', { length: 96 }),
    status: agentActionStatus('status').notNull().default('PROPOSED'),
    // Idempotency: same (session, tool, argsHash) must not run twice.
    idempotencyKey: varchar('idempotency_key', { length: 120 }),
    externalResourceId: varchar('external_resource_id', { length: 255 }),
    resultSummary: varchar('result_summary', { length: 500 }),
    error: varchar('error', { length: 300 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    executedAt: timestamp('executed_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => ({
    sessionIdx: index('agent_actions_session_idx').on(t.agentSessionId),
    statusIdx: index('agent_actions_status_idx').on(t.status),
    toolIdx: index('agent_actions_tool_idx').on(t.toolId),
    // Prevent duplicate external writes within a session (same normalized action).
    idemUnique: unique('agent_actions_idem_unique').on(t.agentSessionId, t.idempotencyKey),
  }),
);

/** Single-use, expiring human approval bound to the EXACT normalized action. */
export const approvalRequests = pgTable(
  'approval_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actionId: uuid('action_id').notNull().references(() => agentActions.id, { onDelete: 'cascade' }),
    agentSessionId: uuid('agent_session_id').notNull(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id'),
    toolId: varchar('tool_id', { length: 64 }).notNull(),
    riskLevel: varchar('risk_level', { length: 32 }).notNull(),
    // Binds approval to the exact action; if the model changes args, the hash breaks.
    argumentsHash: varchar('arguments_hash', { length: 96 }).notNull(),
    // The preview the user actually saw + approved (no secrets/tokens).
    preview: jsonb('preview'),
    status: approvalStatus('status').notNull().default('PENDING'),
    decidedByUserId: uuid('decided_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    actionIdx: index('approval_requests_action_idx').on(t.actionId),
    statusIdx: index('approval_requests_status_idx').on(t.status),
    expiresIdx: index('approval_requests_expires_idx').on(t.expiresAt),
  }),
);

/** Effective agent policy at a scope. Platform is the most restrictive ceiling. */
export const agentPolicies = pgTable(
  'agent_policies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    scope: agentPolicyScope('scope').notNull(),
    // scopeId: null for PLATFORM; organizationId for ORGANIZATION; userId for USER.
    scopeId: uuid('scope_id'),
    // Master switches (a stricter scope can turn things OFF, never force ON).
    agentEnabled: boolean('agent_enabled'),
    writeActionsEnabled: boolean('write_actions_enabled'),
    emailSendingEnabled: boolean('email_sending_enabled'),
    calendarActionsEnabled: boolean('calendar_actions_enabled'),
    slackPostingEnabled: boolean('slack_posting_enabled'),
    crmWritesEnabled: boolean('crm_writes_enabled'),
    maxStepsPerSession: integer('max_steps_per_session'),
    // Per-tool overrides: { "gmail.send": "DENY" | "REQUIRE_APPROVAL" | "ALLOW" }.
    toolOverrides: jsonb('tool_overrides').$type<Record<string, string>>().default({}),
    // Cross-connector transfer requires approval by default; a scope may DENY it.
    crossConnectorTransfer: varchar('cross_connector_transfer', { length: 24 }),
    updatedByUserId: uuid('updated_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    scopeUnique: unique('agent_policies_scope_unique').on(t.scope, t.scopeId),
  }),
);

export type AgentSession = typeof agentSessions.$inferSelect;
export type AgentStep = typeof agentSteps.$inferSelect;
export type AgentAction = typeof agentActions.$inferSelect;
export type ApprovalRequest = typeof approvalRequests.$inferSelect;
export type AgentPolicy = typeof agentPolicies.$inferSelect;
