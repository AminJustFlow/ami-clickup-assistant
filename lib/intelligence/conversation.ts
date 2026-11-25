import type { IntelligenceComment } from './context';

export type ConversationCitation = { commentId: number; excerpt: string; author: string | null; at: string };

export function conversationCitation(comments: IntelligenceComment[], reference?: { comment_id: number; excerpt: string } | null): ConversationCitation | undefined {
  if (!reference) return;
  const comment = comments.find(item => item.id === reference.comment_id);
  const excerpt = reference.excerpt.replace(/\s+/g, ' ').trim();
  if (!comment?.createdAt || !excerpt || !comment.body.replace(/\s+/g, ' ').includes(excerpt)) return;
  return { commentId: comment.id, author: comment.authorName, excerpt, at: comment.createdAt.toISOString() };
}

function readCitation(value: unknown): ConversationCitation | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Partial<ConversationCitation>;
  return Number.isSafeInteger(data.commentId) && typeof data.excerpt === 'string' && data.excerpt.trim() &&
    typeof data.at === 'string' && Number.isFinite(Date.parse(data.at)) && (data.author === null || typeof data.author === 'string')
    ? data as ConversationCitation : null;
}

export function groupConversationUpdates<T extends { taskId: number; kind: string; conversationCitation: unknown; task: { clientId: number } }>(updates: T[]) {
  const groups: { citation: ConversationCitation | null; items: T[] }[] = [];
  const byInstruction = new Map<string, typeof groups[number]>();
  for (const update of updates) {
    const citation = readCitation(update.conversationCitation);
    const key = citation && JSON.stringify([update.task.clientId, update.kind, citation.commentId, citation.excerpt]);
    const group = key ? byInstruction.get(key) : undefined;
    if (group) {
      if (!group.items.some(item => item.taskId === update.taskId)) group.items.push(update);
    } else {
      const entry = { citation, items: [update] };
      groups.push(entry);
      if (key) byInstruction.set(key, entry);
    }
  }
  return groups;
}
