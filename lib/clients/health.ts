/**
 * Client-level signals from existing analyzed ClickUp tasks. No AI calls,
 * persistence, ClickUp writes, or speculative client health scores.
 */
export type ClientHealthSignals = {
  total: number;
  analyzed: number;
  needsAmi: number;
  overdue: number;
  blocked: number;
  waiting: number;
  dueSoon: number;
};

export function clientHealthStatus(client: ClientHealthSignals): 'Attention needed' | 'Watch' | 'No flagged issues' | 'Insufficient analysis' {
  if (client.overdue > 0 || client.blocked > 0 || client.needsAmi > 0) return 'Attention needed';
  if (client.waiting > 0 || client.dueSoon > 0) return 'Watch';
  if (client.total === 0 || client.analyzed === 0) return 'Insufficient analysis';
  return 'No flagged issues';
}

/** These are indicators from analyzed tasks, not a definitive project health assessment. */
export function compareClientHealth(a: ClientHealthSignals & { name: string }, b: ClientHealthSignals & { name: string }): number {
  return b.overdue - a.overdue
    || b.blocked - a.blocked
    || b.needsAmi - a.needsAmi
    || b.dueSoon - a.dueSoon
    || b.waiting - a.waiting
    || a.name.localeCompare(b.name);
}

/** Explicit UTC-time window; caller determines the clock once per request. */
export function dueWithinDays(dueDate: Date | null, now: Date, days = 7): boolean {
  if (!dueDate || !Number.isFinite(dueDate.getTime())) return false;
  const due = dueDate.getTime();
  return due >= now.getTime() && due <= now.getTime() + days * 86400000;
}
