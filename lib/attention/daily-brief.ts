const day = 86_400_000;
const shortDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
const blockedLanguage = /\b(?:blocked|on hold|waiting (?:on|for)|can(?:not|'t) (?:proceed|publish|send|print|start)|before we can)\b/i;
const decisionLanguage = /\b(?:approv(?:e|al)|review|feedback|blocked|decid(?:e|ing)|decision|confirm|sign[ -]?off|choose|which|waiting|go.ahead)\b/i;

type PrioritySignal = { tier: number; evidenceAt: number; deadline: number; reason: string };
type PrioritySource = {
  dueDate?: Date | null;
  comments?: readonly { id: number; authorName: string | null; body: string; clickupCreatedAt: Date | null }[];
  intelligence: { evidenceReferences?: unknown; unresolvedRequest?: string | null; amiAction?: string | null; amiAttentionScore: number | null } | null;
};

export function decisionPriority(task: PrioritySource, now: Date): PrioritySignal {
  const intel = task.intelligence;
  const references = Array.isArray(intel?.evidenceReferences) ? intel.evidenceReferences : [];
  let latest = 0;
  let quote = '';
  let blocked = false;
  for (const ref of references) {
    if (ref?.source_type !== 'COMMENT' || typeof ref.excerpt !== 'string' || !decisionLanguage.test(ref.excerpt)) continue;
    const source = task.comments?.find(comment => String(comment.id) === ref.source_id);
    const at = source?.clickupCreatedAt?.getTime() ?? 0;
    const excerpt = ref.excerpt.trim().replace(/\s+/g, ' ');
    if (!source || at <= latest || at > now.getTime() || !source.body.replace(/\s+/g, ' ').includes(excerpt)) continue;
    blocked = blockedLanguage.test(excerpt);
    latest = at;
    quote = (source?.authorName || 'ClickUp comment') + ' on ' + shortDate.format(at) + ': ' + excerpt;
  }
  const recent = latest > 0 && latest >= now.getTime() - 7 * day;
  const due = task.dueDate?.getTime() ?? Infinity;
  const dueToday = task.dueDate && task.dueDate.toLocaleDateString('en-US', { timeZone: 'America/New_York' }) === now.toLocaleDateString('en-US', { timeZone: 'America/New_York' });
  const upcoming = Boolean(dueToday) || (due >= now.getTime() && due <= now.getTime() + 2 * day);
  const overdue = due < now.getTime() && !dueToday;
  const renewed = overdue && recent && latest >= due;
  const tier = upcoming || renewed || (recent && blocked) ? 0 : recent ? 1 : overdue ? 3 : 2;
  const deadlineReason = upcoming ? 'Due ' + shortDate.format(due) + '. ' :
    renewed ? 'Past the ' + shortDate.format(due) + ' deadline. ' : '';
  const request = intel?.unresolvedRequest?.trim() || intel?.amiAction?.trim() || 'Review the open request.';
  return { tier, evidenceAt: latest, deadline: upcoming ? due : Number.MAX_SAFE_INTEGER,
    reason: deadlineReason + (recent ? quote : request) };
}

/**
 * Deterministic, read-only briefing. Counts reflect analyzed and open Ami
 * recommendations only; they are not a claim about all ClickUp work.
 */
export type BriefItem = PrioritySource & {
  prioritySignal?: PrioritySignal;
  id: number;
  name?: string;
  client?: { name: string };
  overdue: boolean;
  dueDate?: Date | null;
  clickupUpdatedAt?: Date | null;
  verificationReasons: string[];
  intelligence: { amiAttentionScore: number | null; amiAction?: string | null; lastMeaningfulChangeAt?: Date | null } | null;
};

export function compareAttentionPriority<T extends BriefItem>(a: T, b: T, now = new Date()): number {
  const left = a.prioritySignal ?? decisionPriority(a, now);
  const right = b.prioritySignal ?? decisionPriority(b, now);
  return left.tier - right.tier || right.evidenceAt - left.evidenceAt ||
    left.deadline - right.deadline || (b.intelligence?.amiAttentionScore ?? 0) - (a.intelligence?.amiAttentionScore ?? 0) || a.id - b.id;
}

export function dailyBrief<T extends BriefItem>(items: readonly T[], now = new Date()) {
  const ready = items.filter(item => item.verificationReasons.length === 0);
  const verify = items.filter(item => item.verificationReasons.length > 0);
  const byPriority = (a: T, b: T) => compareAttentionPriority(a, b, now);
  const ordered = [...ready].sort(byPriority);
  return {
    open: items.length,
    ready: ready.length,
    verify: verify.length,
    overdueReady: ready.filter(item => item.overdue).length,
    orderedReady: ordered,
    topReady: ordered.slice(0, 3),
    // Do not present an unverified recommendation as a confirmed decision.
    topToVerify: [...verify].sort(byPriority).slice(0, 3)
  };
}
