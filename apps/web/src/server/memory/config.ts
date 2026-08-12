/**
 * Memory platform feature flags (kill switches). These are PLATFORM-level switches;
 * per-user CONSENT lives on the profile (memoryEnabled/memoryMode) and plan
 * entitlements gate availability. Effective behavior = platform AND plan AND consent.
 */

/** Master switch — false disables ALL memory retrieval + creation platform-wide. */
export function memoryPlatformEnabled(): boolean {
  return process.env.MEMORY_ENABLED !== 'false';
}

/** Inferred-memory extraction switch (candidates). Off by default. */
export function memoryInferenceEnabled(): boolean {
  return process.env.MEMORY_INFERENCE_ENABLED === 'true';
}

/** Auto-save of low-risk inferred memory (still requires AUTO consent + plan). Off by default. */
export function memoryAutoSaveEnabled(): boolean {
  return process.env.MEMORY_AUTO_SAVE_ENABLED === 'true';
}

/** Organization memory switch. On by default (still plan- + manager-gated). */
export function organizationMemoryPlatformEnabled(): boolean {
  return process.env.ORGANIZATION_MEMORY_ENABLED !== 'false';
}
