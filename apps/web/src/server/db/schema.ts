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

export const userRole = pgEnum('user_role', ['USER', 'ADMIN']);
export const messageRole = pgEnum('message_role', ['user', 'assistant', 'system']);
// Plan tier — routing readiness (Phase 5 adds billing). Everyone is FREE for now.
export const userPlan = pgEnum('user_plan', ['FREE', 'PRO', 'BUSINESS', 'ENTERPRISE', 'ADMIN']);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 320 }).notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    role: userRole('role').notNull().default('USER'),
    plan: userPlan('plan').notNull().default('FREE'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailIdx: index('users_email_idx').on(t.email),
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
    title: varchar('title', { length: 200 }).notNull().default('New conversation'),
    // The logical model id last used (from the gateway registry). Not a vendor name.
    model: varchar('model', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('conversations_user_idx').on(t.userId),
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
  // Routing priority class (lower = higher priority). Readiness for priority routing.
  priorityClass: integer('priority_class').notNull().default(100),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Plan assignment history — supports trials / expiry / promotions (readiness). */
export const planAssignments = pgTable(
  'plan_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    planSlug: varchar('plan_slug', { length: 32 }).notNull(),
    assignedBy: uuid('assigned_by').references(() => users.id, { onDelete: 'set null' }),
    note: varchar('note', { length: 200 }),
    // Trial / subscription window readiness. endsAt = null means open-ended.
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull().defaultNow(),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    // Future org-level allowances.
    organizationId: uuid('organization_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('plan_assignments_user_idx').on(t.userId),
  }),
);

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
