/**
 * Auth constants with NO Node dependencies, so the Edge middleware can import
 * them without pulling in node:crypto / the database. Keep this file import-free.
 */
export const SESSION_COOKIE = 'biina_session';
