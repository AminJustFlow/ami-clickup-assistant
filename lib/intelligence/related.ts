import type { TaskContext } from './context';

export type RelatedEvidence = { context: TaskContext; reason: string };

// Conservative retrieval: exact ClickUp task references or meaningful shared title terms.
// Same-list membership alone is not evidence of a dependency.
const stop = new Set(['task','client','review','create','edit','send','final','finalize','collect','complete','setup','update','project','v1','v2','v3','v4','v5','work','website','design','content','assets','graphic','copywriting','meeting','management','the','and','for','with','from','into','new','page','social','media','organic','posts','cover','images','feedback','testing','draft','approval','done','process','vbc1','vbc2','week','monitoring','monthly','recurring']);
function terms(s: string): Set<string> {
  return new Set((s.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []).filter(t => !stop.has(t)));
}
function explicitReference(source: TaskContext, candidate: TaskContext): boolean {
  const text = [source.description ?? '', ...source.comments.map(c => c.body)].join(' ');
  // Only exact task IDs, not ambiguous numeric fragments.
  return new RegExp('(^|[^a-zA-Z0-9])' + candidate.clickupTaskId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-zA-Z0-9]|$)', 'i').test(text);
}
export function findRelatedTasks(task: TaskContext, all: TaskContext[], limit = 3): RelatedEvidence[] {
  const a = terms(task.name);
  const hasDependency = (task.dependencyTaskIds?.length ?? 0) > 0;
  const ranked = all.filter(other => other.taskId !== task.taskId).map(other => {
    const dependency = (task.dependencyTaskIds ?? []).includes(other.clickupTaskId) || (other.dependencyTaskIds ?? []).includes(task.clickupTaskId);
    const direct = dependency ? false : explicitReference(task, other) || explicitReference(other, task);
    const b = terms(other.name);
    const overlap = [...a].filter(t => b.has(t));
    // Avoid matching generic workflow stages (e.g. multiple unrelated "Review Graphic Design" tasks).
    const strong = overlap.length >= 2 && a.size >= 2 && b.size >= 2;
    const sameList = task.listName === other.listName;
    const score = dependency ? 200 : direct ? 100 : strong && sameList && !hasDependency ? overlap.length * 10 : 0;
    return { other, score, reason: dependency ? 'ClickUp dependency reference (direction and blocker status not inferred)' : direct ? 'Explicit ClickUp task reference' : 'Shared distinctive title terms in the same list' };
  }).filter(x => x.score > 0).sort((a,b) => b.score-a.score || a.other.clickupTaskId.localeCompare(b.other.clickupTaskId));
  return ranked.slice(0,limit).map(x => ({context:x.other,reason:x.reason}));
}
export function relatedEvidenceText(related: RelatedEvidence[]): string {
  if (!related.length) return '';
  return related.map(({context:c,reason}) => {
    const comments = c.comments.slice(-8).map(x => `[${x.createdAt?.toISOString() ?? 'unknown'}] ${x.authorName ?? 'Unknown'}: ${x.body.slice(0,1400)}`).join('\n');
    return `Related task ID: ${c.clickupTaskId}\nReason: ${reason}\nTitle: ${c.name}\nList: ${c.listName}\nStatus: ${c.status ?? 'unknown'}\nLast updated: ${c.updatedAt?.toISOString() ?? 'unknown'}\nDescription: ${(c.description ?? '').slice(0,1800)}\nRecent comments:\n${comments || 'none'}`;
  }).join('\n\n');
}
