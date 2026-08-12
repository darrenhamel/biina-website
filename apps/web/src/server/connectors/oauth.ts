import { randomBytes, createHash } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { oauthStates, connections } from '@/server/db/schema';
import type { Connection } from '@/server/db/schema';
import { resolveOrgContextById } from '@/server/org/organizations';
import { isOrgManager } from '@/server/auth/permissions';
import { logSecurityEvent } from '@/server/auth/events';
import { badRequest, forbidden, notFound } from '@/lib/errors';
import { getConnectorDefinition } from './registry';
import { getAdapter } from './adapters';
import { saveCredential, type OAuthCredential } from './credentials';
import { appBaseUrl } from '@/server/billing/config';

/**
 * Centralized OAuth — one flow for all connectors (no per-connector duplication).
 * State is cryptographically random, single-use, expiring, and BOUND to the
 * initiating user + connector + connection type + org. PKCE is used where the
 * provider supports it. The callback re-validates everything and never trusts
 * arbitrary redirect params. A `mock` provider completes the flow offline.
 */

const STATE_TTL_MS = 10 * 60 * 1000;

interface ProviderOAuth {
  authUrl: string;
  tokenUrl: string;
  usesPkce: boolean;
  clientId?: string;
  clientSecret?: string;
}

function providerConfig(providerType: string): ProviderOAuth | null {
  switch (providerType) {
    case 'google':
      return { authUrl: 'https://accounts.google.com/o/oauth2/v2/auth', tokenUrl: 'https://oauth2.googleapis.com/token', usesPkce: true, clientId: process.env.GOOGLE_OAUTH_CLIENT_ID, clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET };
    case 'mock':
      return { authUrl: `${appBaseUrl()}/api/connectors/callback`, tokenUrl: '', usesPkce: false };
    default:
      return null;
  }
}

function redirectUri(): string {
  // Explicitly configured — never an arbitrary callback destination.
  return process.env.CONNECTOR_OAUTH_REDIRECT_URI || `${appBaseUrl()}/api/connectors/callback`;
}

export interface BeginParams {
  userId: string;
  connectorSlug: string;
  connectionType: 'PERSONAL' | 'ORGANIZATION';
  organizationId: string | null;
}

/** Start an OAuth connect. Returns the provider authorization URL. */
export async function beginOAuth(params: BeginParams): Promise<{ authorizationUrl: string }> {
  const def = await getConnectorDefinition(params.connectorSlug);
  if (!def || !def.enabled) throw notFound('Connector not available');
  if (params.connectionType === 'PERSONAL' && !def.supportsPersonal) throw badRequest('This connector does not support personal connections');
  if (params.connectionType === 'ORGANIZATION') {
    if (!def.supportsOrganization) throw badRequest('This connector does not support organization connections');
    if (!params.organizationId) throw badRequest('No active organization');
    const ctx = await resolveOrgContextById(params.userId, params.organizationId);
    if (!ctx) throw notFound('Not found');
    if (!isOrgManager(ctx.role)) throw forbidden('Only organization managers can connect organization integrations');
  }
  const provider = providerConfig(def.providerType);
  if (!provider) throw badRequest('Unsupported provider');

  const state = randomBytes(24).toString('base64url');
  const codeVerifier = provider.usesPkce ? randomBytes(32).toString('base64url') : null;
  await getDb().insert(oauthStates).values({
    state,
    userId: params.userId,
    connectorSlug: params.connectorSlug,
    connectionType: params.connectionType,
    organizationId: params.organizationId,
    codeVerifier: codeVerifier ?? undefined,
    expiresAt: new Date(Date.now() + STATE_TTL_MS),
  });

  const url = new URL(provider.authUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', redirectUri());
  url.searchParams.set('state', state);
  url.searchParams.set('scope', (def.scopes ?? []).join(' '));
  if (provider.clientId) url.searchParams.set('client_id', provider.clientId);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  if (codeVerifier) {
    url.searchParams.set('code_challenge', createHash('sha256').update(codeVerifier).digest('base64url'));
    url.searchParams.set('code_challenge_method', 'S256');
  }
  if (def.providerType === 'mock') url.searchParams.set('code', 'mock-auth-code'); // self-callback completes offline
  return { authorizationUrl: url.toString() };
}

/** Exchange a provider code for tokens (mock returns canned tokens). */
async function exchangeCode(providerType: string, code: string, codeVerifier: string | null): Promise<OAuthCredential> {
  if (providerType === 'mock') {
    return { accessToken: `mock-access-${randomBytes(6).toString('hex')}`, refreshToken: 'mock-refresh', tokenType: 'Bearer', expiresAt: Date.now() + 3600_000 };
  }
  const provider = providerConfig(providerType)!;
  const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(), client_id: provider.clientId ?? '', client_secret: provider.clientSecret ?? '' });
  if (codeVerifier) body.set('code_verifier', codeVerifier);
  const res = await fetch(provider.tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (!res.ok) throw badRequest('Token exchange failed');
  const j = (await res.json()) as { access_token: string; refresh_token?: string; token_type?: string; scope?: string; expires_in?: number };
  return { accessToken: j.access_token, refreshToken: j.refresh_token, tokenType: j.token_type, scope: j.scope, expiresAt: j.expires_in ? Date.now() + j.expires_in * 1000 : undefined };
}

/**
 * Complete OAuth: validate + single-use-consume the state, exchange the code,
 * verify the account, and create/activate the connection with an encrypted
 * credential. `expectedUserId` (the callback's authenticated session) must match
 * the state's user — defends against OAuth CSRF / account-linking.
 */
export async function completeOAuth(state: string, code: string, expectedUserId: string): Promise<Connection> {
  const db = getDb();
  // Atomic single-use consume: only an unused, unexpired state flips.
  const [row] = await db
    .update(oauthStates)
    .set({ usedAt: new Date() })
    .where(and(eq(oauthStates.state, state), isNull(oauthStates.usedAt), gt(oauthStates.expiresAt, new Date())))
    .returning();
  if (!row) throw badRequest('Invalid, expired, or already-used authorization state');
  if (row.userId !== expectedUserId) throw forbidden('Authorization does not belong to this session');

  const def = await getConnectorDefinition(row.connectorSlug);
  if (!def) throw notFound('Connector not available');
  const cred = await exchangeCode(def.providerType, code, row.codeVerifier);

  const adapter = getAdapter(row.connectorSlug);
  const info = adapter?.testConnection ? await adapter.testConnection(cred) : { ok: true };
  if (!info.ok) throw badRequest('Could not verify the connected account');

  const [conn] = await db
    .insert(connections)
    .values({
      connectorSlug: row.connectorSlug,
      userId: row.connectionType === 'PERSONAL' ? row.userId : null,
      organizationId: row.connectionType === 'ORGANIZATION' ? row.organizationId : null,
      connectionType: row.connectionType,
      externalAccountId: info.externalAccountId ?? null,
      externalAccountEmail: info.externalAccountEmail ?? null,
      externalAccountName: info.externalAccountName ?? null,
      status: 'ACTIVE',
      grantedScopes: def.scopes ?? [],
      capabilities: def.capabilities ?? [],
      connectedByUserId: row.userId,
      connectedAt: new Date(),
    })
    .returning();
  await saveCredential(conn.id, cred);
  await logSecurityEvent({
    event: 'connector.connected',
    userId: row.userId,
    actorUserId: row.userId,
    organizationId: row.organizationId,
    metadata: { connectionId: conn.id, connector: row.connectorSlug, type: row.connectionType },
  });
  return conn;
}
