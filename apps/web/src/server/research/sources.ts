import { createHash } from 'node:crypto';
import type { Plan } from '@/server/db/schema';
import { logger } from '@/lib/logger';
import { groundWithWeb } from '@/server/web/service';
import { retrieveKnowledge } from '@/server/rag/retrieval';
import { searchConnectedSources } from '@/server/connectors/connected-search';
import type { ResearchSourceType } from './profiles';

/**
 * ResearchSourceProvider — the ONLY way a specialist obtains evidence. It delegates
 * to the existing, tenant-isolated retrieval layers (web / RAG / connected), so all
 * Phase 8–10 authorization + provenance + prompt-injection boundaries are inherited.
 * A specialist can only touch source types its task scope allows; private content is
 * never sent to public web search. Injectable for deterministic tests/demos.
 */

export interface RawEvidence {
  sourceType: ResearchSourceType;
  sourceId: string;
  title: string;
  sourceReference: string;
  excerpt: string;
  publishedAt?: Date | null;
  relevance?: number;
  quality?: { primarySource?: boolean; officialSource?: boolean; domain?: string; date?: string };
}

export interface RetrieveInput {
  sourceType: ResearchSourceType;
  query: string;
  userId: string;
  organizationId: string | null;
  knowledgeBaseIds: string[];
  connectionIds: string[];
  plan: Plan;
  max: number;
  signal?: AbortSignal;
}

export interface ResearchSourceProvider {
  readonly name: string;
  retrieve(input: RetrieveInput): Promise<RawEvidence[]>;
}

export function contentHash(e: { sourceId: string; excerpt: string }): string {
  return createHash('sha256').update(`${e.sourceId}\n${e.excerpt.trim().toLowerCase()}`).digest('hex').slice(0, 32);
}

/** Default provider — delegates to the tenant-isolated retrieval services. */
class DelegatingSourceProvider implements ResearchSourceProvider {
  readonly name = 'delegating';
  async retrieve(input: RetrieveInput): Promise<RawEvidence[]> {
    try {
      if (input.sourceType === 'PUBLIC_WEB' || input.sourceType === 'PRIMARY_OFFICIAL_SOURCE') {
        const web = await groundWithWeb({ query: input.query, userId: input.userId, organizationId: input.organizationId, plan: input.plan, conversationId: undefined, signal: input.signal });
        return web.citations.slice(0, input.max).map((c) => ({ sourceType: input.sourceType, sourceId: c.url, title: c.title || c.url, sourceReference: c.url, excerpt: c.title ?? c.url, publishedAt: c.publishedAt ? new Date(c.publishedAt) : null, quality: { domain: c.domain || safeDomain(c.url), officialSource: input.sourceType === 'PRIMARY_OFFICIAL_SOURCE' } }));
      }
      if (input.sourceType === 'KNOWLEDGE_BASE' || input.sourceType === 'PRIVATE_DOCUMENT') {
        if (!input.knowledgeBaseIds.length) return [];
        const { results } = await retrieveKnowledge({ query: input.query, userId: input.userId, organizationId: input.organizationId, knowledgeBaseIds: input.knowledgeBaseIds });
        return results.slice(0, input.max).map((r) => ({ sourceType: input.sourceType, sourceId: r.chunkId, title: r.documentName, sourceReference: `${r.documentName}${r.pageNumber ? ` p.${r.pageNumber}` : ''}`, excerpt: r.content.slice(0, 600), relevance: r.score, quality: { primarySource: true } }));
      }
      if (input.sourceType.startsWith('CONNECTED_')) {
        if (!input.connectionIds.length) return [];
        const connected = await searchConnectedSources({ query: input.query, userId: input.userId, organizationId: input.organizationId, connectionIds: input.connectionIds, plan: input.plan, signal: input.signal });
        return connected.citations.slice(0, input.max).map((c) => ({ sourceType: input.sourceType, sourceId: c.externalId, title: c.name, sourceReference: `${c.connector}: ${c.name}`, excerpt: c.name, quality: { primarySource: true } }));
      }
      return [];
    } catch (err) {
      logger.info('research.source.retrieve_failed', { sourceType: input.sourceType, error: String(err) });
      return [];
    }
  }
}

function safeDomain(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

let provider: ResearchSourceProvider = new DelegatingSourceProvider();
export function getSourceProvider(): ResearchSourceProvider {
  return provider;
}
/** Test/demo hook — inject synthetic sources (pass null to restore delegation). */
export function setSourceProvider(p: ResearchSourceProvider | null): void {
  provider = p ?? new DelegatingSourceProvider();
}
