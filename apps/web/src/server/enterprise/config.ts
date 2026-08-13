/**
 * Enterprise / sovereign feature flags (Phase 17).
 *
 * Flags NEVER replace server-side authorization — they only gate whether a surface
 * is available at all. Default posture is safe: enterprise features on, but SSO/SAML/
 * SCIM and sovereign mode OFF until an organization is explicitly configured.
 */

function flag(name: string, def: boolean): boolean {
  const v = process.env[name];
  if (v == null || v === '') return def;
  return v === 'true' || v === '1';
}

export function enterpriseFeaturesEnabled(): boolean {
  return flag('ENTERPRISE_FEATURES_ENABLED', true);
}
export function samlEnabled(): boolean {
  return flag('SAML_ENABLED', false);
}
export function scimEnabled(): boolean {
  return flag('SCIM_ENABLED', false);
}
export function dedicatedProviderSupportEnabled(): boolean {
  return flag('DEDICATED_PROVIDER_SUPPORT_ENABLED', true);
}
/** When true, external AI / web / connectors are disabled platform-wide unless a
 *  deployment profile explicitly re-allows them. A hard, conservative default. */
export function sovereignModeEnabled(): boolean {
  return flag('SOVEREIGN_MODE_ENABLED', false);
}
