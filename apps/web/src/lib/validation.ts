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

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ChatRequestInput = z.infer<typeof chatRequestSchema>;
