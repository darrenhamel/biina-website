/**
 * Workspace context cookie — the user's active workspace ('personal' or an org
 * slug). It is only a HINT: the server always re-verifies membership (see
 * resolveOrgContext) before granting any organization access.
 */
export const WORKSPACE_COOKIE = 'biina_workspace';
