export type ActivityInput = {
  state: string;
  taskUpdatedAt: Date | null;
  commentDates: (Date | null)[];
};

export function lastSourceActivity(input: ActivityInput): Date | null {
  const timestamps = [input.taskUpdatedAt, ...input.commentDates].filter(
    (value): value is Date => value instanceof Date && Number.isFinite(value.getTime())
  );
  return timestamps.length ? new Date(Math.max(...timestamps.map(value => value.getTime()))) : null;
}

/** A stale flag is a review signal, not proof work has stopped. */
export function isStaleActive(input: ActivityInput, now = new Date(), days = 30): boolean {
  if (input.state !== 'ACTIVE') return false;
  const latest = lastSourceActivity(input);
  return latest !== null && latest.getTime() < now.getTime() - days * 86400000;
}

export function activityLabel(input: ActivityInput, now = new Date()): string {
  const latest = lastSourceActivity(input);
  if (!latest) return 'Last activity unknown';
  const days = Math.max(0, Math.floor((now.getTime() - latest.getTime()) / 86400000));
  return days === 0 ? 'Last activity today' : days === 1 ? 'Last activity 1 day ago' : `Last activity ${days} days ago`;
}
