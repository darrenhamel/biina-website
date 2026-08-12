/**
 * Multimodal platform feature flags. Effective availability = platform flag AND
 * plan entitlement AND (where relevant) org policy. Provider selection + secrets are
 * server-side; product policy that admins should tune lives in plans/DB, not here.
 */

export function multimodalEnabled(): boolean {
  return process.env.MULTIMODAL_ENABLED !== 'false';
}

export function voiceModeEnabled(): boolean {
  return process.env.VOICE_MODE_ENABLED === 'true';
}
