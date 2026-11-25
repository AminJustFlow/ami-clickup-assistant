import type { WaitingOnType } from '@prisma/client';
import type { IntelligenceComment } from './context';

type Dependency = { waitingOnType: WaitingOnType; waitingOnName?: string | null };
export type HandoffEvidence = { excerpt: string; at: Date; author: string | null };

function actor(dependency: Dependency): string | null {
  if (dependency.waitingOnType === 'NONE') return null;
  const roles = { AMI: 'Ami', TEAM: 'the team', CLIENT: 'the client', VENDOR: 'the vendor', OTHER: null };
  return dependency.waitingOnName?.trim() || roles[dependency.waitingOnType];
}

export function dependencyChanged(prior: Dependency, next: Dependency): boolean {
  return prior.waitingOnType !== next.waitingOnType ||
    actor(prior)?.toLowerCase() !== actor(next)?.toLowerCase();
}

export function handoffEvidence(comments: IntelligenceComment[], citation: { comment_id: number; excerpt: string } | null): HandoffEvidence | undefined {
  if (!citation) return;
  const comment = comments.find(item => item.id === citation.comment_id);
  const excerpt = citation.excerpt.replace(/\s+/g, ' ').trim();
  if (!excerpt || !comment?.createdAt || !comment.body.replace(/\s+/g, ' ').includes(excerpt)) return;
  return { excerpt, at: comment.createdAt, author: comment.authorName };
}

export function handoffSummary(prior: Dependency, next: Dependency, since: Date | null, evidence?: HandoffEvidence): string | null {
  if (!since || !evidence || evidence.at <= since || !dependencyChanged(prior, next)) return null;
  const from = actor(prior), to = actor(next);
  if ((!from && prior.waitingOnType !== 'NONE') || (!to && next.waitingOnType !== 'NONE')) return null;
  const change = from && to ? `Handoff from ${from} to ${to}.` : to ? `Now waiting on ${to}.` : `No longer waiting on ${from}.`;
  return `${change} ${evidence.author ? evidence.author + ': ' : ''}"${evidence.excerpt}"`;
}
