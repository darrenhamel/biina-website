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
    // Cost readiness (optional; not exposed to normal users).
    estimatedInputCost: real('estimated_input_cost'),
    estimatedOutputCost: real('estimated_output_cost'),
    infraCostClass: varchar('infra_cost_class', { length: 24 }),
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
