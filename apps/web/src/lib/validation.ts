import { z } from 'zod';

/** Shared Zod schemas. Every API boundary validates its input with these. */

export const emailSchema = z.string().trim().toLowerCase().email().max(320);

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(200);

export const signupSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  email: emailSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});

export const chatMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string().min(1).max(20_000),
});

export const chatRequestSchema = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().trim().min(1).max(20_000),
  // A user-approved BIINA model slug (logical id), NEVER an infra model or URL.
  model: z
    .string()
    .max(64)
    .regex(/^[a-z0-9-]+$/i, 'invalid model id')
    .optional(),
  // Optional workload hint; validated against the allowed set in the router.
  workload: z.string().max(32).optional(),
  // Phase 8 — optional knowledge-base selection for RAG (access re-verified server-side).
  knowledgeBaseIds: z.array(z.string().uuid()).max(20).optional(),
  ragMode: z.enum(['off', 'strict', 'blended']).optional(),
  // Phase 9 — opt-in web search (user-controlled). Entitlement/quota enforced server-side.
  webSearch: z.boolean().optional(),
  freshness: z.enum(['any', 'day', 'week', 'month', 'year']).optional(),
  // Phase 10 — explicitly selected connected sources (access re-verified server-side).
  connectionIds: z.array(z.string().uuid()).max(8).optional(),
});

export const renameConversationSchema = z.object({
  title: z.string().trim().min(1).max(200),
});

export const updateProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  locale: z.enum(['en', 'ar']).optional(),
  personaId: z.string().max(32).nullable().optional(),
});

// ---- Admin AI control-plane schemas ----

export const updateModelSchema = z
  .object({
    enabled: z.boolean().optional(),
    displayName: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(280).nullable().optional(),
    visibleToUsers: z.boolean().optional(),
    adminOnly: z.boolean().optional(),
    maintenanceMode: z.boolean().optional(),
    maintenanceNote: z.string().trim().max(280).nullable().optional(),
    priority: z.number().int().min(0).max(10_000).optional(),
    // Capability toggles (validated keys).
    capabilities: z
      .record(z.enum(['chat', 'streaming', 'reasoning', 'tools', 'vision', 'files', 'structuredOutput', 'longContext']), z.boolean())
      .optional(),
    // Vendor model id (admin-only field; never user-supplied).
    providerModelId: z.string().trim().min(1).max(160).optional(),
  })
  .strict();

export const updateProviderSchema = z
  .object({
    enabled: z.boolean().optional(),
    maintenanceMode: z.boolean().optional(),
    maintenanceNote: z.string().trim().max(280).nullable().optional(),
    priority: z.number().int().min(0).max(10_000).optional(),
  })
  .strict();

export const updateRoutingSchema = z
  .object({
    defaultModelSlug: z.string().max(64).nullable().optional(),
    fallbackEnabled: z.boolean().optional(),
    fallbackModelSlug: z.string().max(64).nullable().optional(),
    maintenanceMode: z.boolean().optional(),
    // scope maps: { persona: { kids: "<slug>" | null, ... }, workload: {...}, plan: {...} }
    personaRoutes: z.record(z.string().max(48), z.string().max(64).nullable()).optional(),
    workloadRoutes: z.record(z.string().max(48), z.string().max(64).nullable()).optional(),
    planRoutes: z.record(z.string().max(48), z.string().max(64).nullable()).optional(),
  })
  .strict();

const nullableInt = z.number().int().min(0).max(1_000_000_000).nullable();

export const updatePlanSchema = z
  .object({
    displayName: z.string().trim().min(1).max(80).optional(),
    enabled: z.boolean().optional(),
    dailyRequestLimit: nullableInt.optional(),
    monthlyRequestLimit: nullableInt.optional(),
    dailyTokenLimit: nullableInt.optional(),
    monthlyTokenLimit: nullableInt.optional(),
    requestsPerMinute: nullableInt.optional(),
    maxConcurrent: nullableInt.optional(),
    maxContextTokens: nullableInt.optional(),
    maxOutputTokens: nullableInt.optional(),
    allowedModels: z.array(z.string().max(64)).optional(),
    allowedWorkloads: z.array(z.string().max(32)).optional(),
    allowedPersonas: z.array(z.string().max(32)).optional(),
    filesEligible: z.boolean().optional(),
    toolsEligible: z.boolean().optional(),
    webSearchEligible: z.boolean().optional(),
    priorityClass: z.number().int().min(0).max(10_000).optional(),
  })
  .strict();

export const assignPlanSchema = z
  .object({
    plan: z.enum(['FREE', 'PRO', 'BUSINESS', 'ENTERPRISE', 'ADMIN']),
    note: z.string().trim().max(200).optional(),
    endsAt: z.string().datetime().nullable().optional(),
  })
  .strict();

const nullableCost = z.number().min(0).max(1_000_000).nullable();

export const updateBudgetSchema = z
  .object({
    currency: z.string().trim().max(8).optional(),
    dailyCostWarn: nullableCost.optional(),
    dailyCostHardLimit: nullableCost.optional(),
    monthlyCostWarn: nullableCost.optional(),
    monthlyCostHardLimit: nullableCost.optional(),
    hardLimitEnabled: z.boolean().optional(),
  })
  .strict();

// ---- Phase 6: identity ----

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});
export const forgotPasswordSchema = z.object({ email: emailSchema });
export const resetPasswordSchema = z.object({ token: z.string().min(16).max(200), newPassword: passwordSchema });
export const tokenSchema = z.object({ token: z.string().min(16).max(200) });

// ---- Phase 6: organizations ----

export const createOrgSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().max(48).optional(),
});
export const updateOrgSchema = z.object({ displayName: z.string().trim().min(2).max(120).optional() }).strict();
const orgRoleEnum = z.enum(['OWNER', 'ADMIN', 'MEMBER']);
export const inviteSchema = z.object({ email: emailSchema, role: orgRoleEnum.default('MEMBER') });
export const memberRoleSchema = z.object({ role: orgRoleEnum });

// ---- Phase 6: platform admin ----

export const setUserStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED', 'DISABLED']),
  reason: z.string().trim().max(280).optional(),
});
export const setUserRoleSchema = z.object({ role: z.enum(['USER', 'ADMIN', 'SUPER_ADMIN']) });
export const setOrgStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED']),
  reason: z.string().trim().max(280).optional(),
});

// ---- Phase 7: billing ----

export const checkoutSchema = z.object({ commercialPriceId: z.string().uuid() });
export const cancelSubSchema = z.object({
  subscriptionId: z.string().uuid(),
  atPeriodEnd: z.boolean().optional().default(true),
});
export const resumeSubSchema = z.object({ subscriptionId: z.string().uuid() });
export const changeSubSchema = z.object({
  subscriptionId: z.string().uuid(),
  commercialPriceId: z.string().uuid(),
});

export const upsertCommercialPriceSchema = z
  .object({
    planSlug: z.enum(['FREE', 'PRO', 'BUSINESS', 'ENTERPRISE', 'ADMIN']),
    displayName: z.string().trim().min(1).max(120),
    providerPriceId: z.string().trim().min(1).max(255),
    currency: z.string().trim().length(3).toUpperCase(),
    amount: z.number().int().min(0).max(100_000_000),
    billingInterval: z.enum(['month', 'year']).default('month'),
    billingIntervalCount: z.number().int().min(1).max(12).default(1),
    trialDays: z.number().int().min(0).max(365).nullable().optional(),
    includedSeats: z.number().int().min(0).max(100_000).nullable().optional(),
    maxSeats: z.number().int().min(0).max(100_000).nullable().optional(),
    perSeatBilling: z.boolean().optional(),
    enabled: z.boolean().optional(),
    publiclyAvailable: z.boolean().optional(),
    isTest: z.boolean().optional(),
  })
  .strict();

export const updateCommercialPriceSchema = upsertCommercialPriceSchema.partial().strict();

export const billingConfigSchema = z
  .object({
    defaultCurrency: z.string().trim().length(3).toUpperCase().optional(),
    taxEnabled: z.boolean().optional(),
    taxMode: z.enum(['none', 'inclusive', 'exclusive']).optional(),
    taxInclusive: z.boolean().optional(),
    taxRegistrationNumber: z.string().trim().max(64).nullable().optional(),
    taxRateReference: z.string().trim().max(120).nullable().optional(),
    legalEntityName: z.string().trim().max(200).nullable().optional(),
    billingCountry: z.string().trim().length(2).toUpperCase().nullable().optional(),
    supportEmail: emailSchema.nullable().optional(),
  })
  .strict();

// ---- Phase 11: agent engine ----

export const startAgentSchema = z
  .object({
    goal: z.string().trim().min(3).max(4000),
    mode: z.enum(['ASSISTED', 'AGENT']).default('ASSISTED'),
    conversationId: z.string().uuid().optional(),
    maxSteps: z.number().int().min(1).max(20).optional(),
    dryRun: z.boolean().optional(),
  })
  .strict();

export const approvalDecisionSchema = z
  .object({
    decision: z.enum(['APPROVED', 'REJECTED']),
    // Optional user edits to the action before approval — produces a NEW action hash.
    editedArguments: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

// Stricter-or-equal agent policy patch (a scope can only tighten safety).
export const agentPolicySchema = z
  .object({
    agentEnabled: z.boolean().nullable().optional(),
    writeActionsEnabled: z.boolean().nullable().optional(),
    emailSendingEnabled: z.boolean().nullable().optional(),
    calendarActionsEnabled: z.boolean().nullable().optional(),
    slackPostingEnabled: z.boolean().nullable().optional(),
    crmWritesEnabled: z.boolean().nullable().optional(),
    maxStepsPerSession: z.number().int().min(1).max(20).nullable().optional(),
    toolOverrides: z.record(z.string().max(64), z.enum(['ALLOW', 'REQUIRE_APPROVAL', 'DENY'])).optional(),
    crossConnectorTransfer: z.enum(['ALLOW', 'REQUIRE_APPROVAL', 'DENY']).nullable().optional(),
  })
  .strict();

// ---- Phase 12: workflows & automations ----

const scheduleObject = z
  .object({
    pattern: z.enum(['once', 'daily', 'weekly', 'monthly', 'cron']),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
    weekday: z.number().int().min(0).max(6).optional(),
    day: z.number().int().min(1).max(31).optional(),
    at: z.string().datetime().optional(),
    cron: z.string().max(120).optional(),
  })
  .strict();

export const workflowTriggerSchema = z
  .object({
    type: z.enum(['MANUAL', 'SCHEDULE', 'CONDITION']),
    schedule: scheduleObject.optional(),
    timezone: z.string().max(64).optional(),
    conditionType: z.enum(['USAGE_THRESHOLD', 'CONNECTOR_NEW_ITEMS', 'SEMANTIC_MATCH']).optional(),
    conditionConfig: z.record(z.string(), z.unknown()).optional(),
    checkIntervalMinutes: z.number().int().min(15).max(1440).optional(),
    missedRunPolicy: z.enum(['SKIP', 'RUN_ONCE_WHEN_RECOVERED', 'CATCH_UP_LIMITED']).optional(),
  })
  .strict();

export const createWorkflowSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    description: z.string().trim().max(600).optional(),
    goal: z.string().trim().min(5).max(8000),
    ownerType: z.enum(['PERSONAL', 'ORGANIZATION']).default('PERSONAL'),
    agentMode: z.enum(['ASSISTED', 'AGENT']).default('AGENT'),
    approvalPolicy: z.enum(['ASK_EVERY_WRITE', 'ASK_HIGH_RISK_ONLY', 'READ_ONLY_AUTOMATIC']).default('ASK_EVERY_WRITE'),
    timezone: z.string().max(64).default('UTC'),
    trigger: workflowTriggerSchema,
    knowledgeBaseIds: z.array(z.string().uuid()).max(20).optional(),
    connectionIds: z.array(z.string().uuid()).max(8).optional(),
    webSearchEnabled: z.boolean().optional(),
    maxSteps: z.number().int().min(1).max(20).optional(),
    maxToolCalls: z.number().int().min(1).max(40).optional(),
    maxWritesPerRun: z.number().int().min(0).max(5).optional(),
    maxCostPerRun: z.number().min(0).max(100).optional(),
    maxRunsPerDay: z.number().int().min(1).max(100).optional(),
    maxRunsPerMonth: z.number().int().min(1).max(3000).optional(),
    notifyOnSuccess: z.enum(['NEVER', 'MEANINGFUL', 'EVERY']).optional(),
    notifyOnFailure: z.boolean().optional(),
  })
  .strict();

export const updateWorkflowSchema = createWorkflowSchema.partial().strict();

export const compileWorkflowSchema = z.object({ text: z.string().trim().min(5).max(2000), timezone: z.string().max(64).optional() }).strict();

export const standingAuthSchema = z
  .object({
    workflowId: z.string().uuid(),
    toolId: z.string().max(64),
    connectionId: z.string().uuid(),
    allowedDestinations: z.array(z.string().trim().min(1).max(320)).min(1).max(20),
    maxExecutions: z.number().int().min(1).max(1000).nullable().optional(),
    maxExecutionsPerDay: z.number().int().min(1).max(100).nullable().optional(),
    expiresInDays: z.number().int().min(1).max(365).default(90),
    confirm: z.literal(true), // explicit user approval to create a standing authorization
  })
  .strict();

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ChatRequestInput = z.infer<typeof chatRequestSchema>;
export type CreateWorkflowInput = z.infer<typeof createWorkflowSchema>;
