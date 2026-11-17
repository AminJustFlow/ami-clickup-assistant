import { compareRecentFirst } from '../tasks/recency';

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
  intelligence: { amiAttentionScore: number | null; amiAction?: string | null; lastMeaningfulChangeAt?: Date | null } | null;
};

/**
 * Stable newest-first ranking. Urgency remains visible metadata and never
 * overrides the latest real activity.
 */
export function compareAttentionPriority<T extends BriefItem>(a: T, b: T, now = new Date()): number {
  void now;
  return compareRecentFirst(a, b);
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
