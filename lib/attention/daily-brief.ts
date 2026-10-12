/**
 * Deterministic, read-only briefing. Counts reflect analyzed and open Ami
 * recommendations only; they are not a claim about all ClickUp work.
 */
export type BriefItem = {
  id: number;
  name?: string;
  client?: { name: string };
  overdue: boolean;
  verificationReasons: string[];
  intelligence: { amiAttentionScore: number | null; amiAction?: string | null } | null;
};

export function dailyBrief<T extends BriefItem>(items: readonly T[]) {
  const ready = items.filter(item => item.verificationReasons.length === 0);
  const verify = items.filter(item => item.verificationReasons.length > 0);
  const byPriority = (a: T, b: T) =>
    Number(b.overdue) - Number(a.overdue) ||
    (b.intelligence?.amiAttentionScore ?? 0) - (a.intelligence?.amiAttentionScore ?? 0) ||
    a.id - b.id;
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
