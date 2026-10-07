/**
 * A stale flag is a review signal, not a claim that work has stopped.
 * Prefer the most recent source activity; never use intelligence.analyzedAt,
 * since re-analysis does not represent actual ClickUp progress.
 */
export function isStaleActive(input: {
  state: string;
  taskUpdatedAt: Date | null;
  commentDates: (Date | null)[];
}, now = new Date(), days = 30): boolean {
  if (input.state !== 'ACTIVE') return false;
  const timestamps = [input.taskUpdatedAt, ...input.commentDates].filter(
    (value): value is Date => value instanceof Date && Number.isFinite(value.getTime())
  );
  if (!timestamps.length) return false;
  return Math.max(...timestamps.map(value => value.getTime())) < now.getTime() - days * 86400000;
}
