import { and, asc, desc, eq } from 'drizzle-orm';
import { getDb } from './db';
import { conversations, messages } from './db/schema';

/** Data access for conversations, always scoped to a userId (ownership enforced). */

export async function listConversations(userId: string) {
  return getDb()
    .select({
      id: conversations.id,
      title: conversations.title,
      updatedAt: conversations.updatedAt,
    })
    .from(conversations)
    .where(eq(conversations.userId, userId))
    .orderBy(desc(conversations.updatedAt));
}

export async function getOwnedConversation(userId: string, id: string) {
  const [row] = await getDb()
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function createConversation(
  userId: string,
  title: string,
  model?: string,
  organizationId?: string | null,
) {
  const [row] = await getDb()
    .insert(conversations)
    .values({ userId, title, model, organizationId: organizationId ?? null })
    .returning();
  return row;
}

export async function renameConversation(userId: string, id: string, title: string) {
  const [row] = await getDb()
    .update(conversations)
    .set({ title, updatedAt: new Date() })
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
    .returning();
  return row ?? null;
}

export async function deleteConversation(userId: string, id: string) {
  const [row] = await getDb()
    .delete(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
    .returning({ id: conversations.id });
  return row ?? null;
}

export async function listMessages(conversationId: string) {
  return getDb()
    .select({
      id: messages.id,
      role: messages.role,
      content: messages.content,
      provider: messages.provider,
      model: messages.model,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt));
}

export async function addMessage(params: {
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  provider?: string;
  model?: string;
  citations?: unknown;
  mediaAssetIds?: string[];
}) {
  const db = getDb();
  const [row] = await db
    .insert(messages)
    .values(params as never)
    .returning();
  // Bump conversation's updatedAt so it sorts to the top.
  await db
    .update(conversations)
    .set({ updatedAt: new Date() })
    .where(eq(conversations.id, params.conversationId));
  return row;
}

/** Persist the RAG knowledge-base selection + mode on a conversation. */
export async function setConversationKnowledge(conversationId: string, knowledgeBaseIds: string[], mode: string) {
  await getDb()
    .update(conversations)
    .set({ ragKnowledgeBaseIds: knowledgeBaseIds, ragMode: mode, updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));
}
