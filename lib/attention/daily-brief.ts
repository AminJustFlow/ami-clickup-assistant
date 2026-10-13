/**
 * Deterministic, read-only briefing. Counts reflect analyzed and open Ami
 * recommendations only; they are not a claim about all ClickUp work.
 */
export type BriefItem = {
  id: number;
  name?: string;
  client?: { name: string };
  overdue: boolean;
  dueDate?: Date | null;
  clickupUpdatedAt?: Date | null;
  verificationReasons: string[];
  intelligence: { amiAttentionScore: number | null; amiAction?: string | null } | null;
};

/**
 * Stable, deterministic ranking of actionable decisions. Overdue work stays first;
 * approaching deadlines are elevated without overriding existing overdue work.
 * Never use this comparator to rank unverified recommendations above verified ones.
 */
export function compareAttentionPriority<T extends BriefItem>(a: T, b: T, now = new Date()): number {
  const urgencyBand = (item: T) => {
    if (item.overdue) return 0;
    const due = item.dueDate?.getTime();
    if (due != null && Number.isFinite(due) && due >= now.getTime() && due <= now.getTime() + 48 * 60 * 60 * 1000) return 1;
    return 2;
  };
  const bandDifference = urgencyBand(a) - urgencyBand(b);
  if (bandDifference) return bandDifference;
  // Within urgent bands, the nearest deadline wins.
  if (urgencyBand(a) < 2) {
    const dateA = a.dueDate?.getTime() ?? Number.POSITIVE_INFINITY;
    const dateB = b.dueDate?.getTime() ?? Number.POSITIVE_INFINITY;
    if (dateA !== dateB) return dateA - dateB;
  }
  const score = (item: T) => {
    const value = item.intelligence?.amiAttentionScore;
    return value != null && Number.isFinite(value) ? value : 0;
  };
  return score(b) - score(a)
    || (b.clickupUpdatedAt?.getTime() ?? 0) - (a.clickupUpdatedAt?.getTime() ?? 0)
    || a.id - b.id;
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
    topReady: ordered.slice(0, 3),
    // Do not present an unverified recommendation as a confirmed decision.
    topToVerify: [...verify].sort(byPriority).slice(0, 3)
  };
}
