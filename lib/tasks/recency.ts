export type ActivityDateInput = Date | string | null | undefined;

export type RecencyTask = {
  id: number;
  groupActivityAt?: ActivityDateInput;
  clickupUpdatedAt?: ActivityDateInput;
  comments?: readonly { clickupCreatedAt?: ActivityDateInput; clickupUpdatedAt?: ActivityDateInput }[];
  events?: readonly { occurredAt?: ActivityDateInput }[];
  intelligence?: object | null;
};

function timestamp(value: ActivityDateInput): number {
  if (!value) return 0;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

/** Latest real source/evidence activity. Due dates and priority never participate. */
export function latestActivityTime(task: RecencyTask): number {
  const intelligence = task.intelligence as { lastMeaningfulChangeAt?: ActivityDateInput } | null | undefined;
  let latest = Math.max(timestamp(task.groupActivityAt), timestamp(task.clickupUpdatedAt), timestamp(intelligence?.lastMeaningfulChangeAt));
  for (const comment of task.comments ?? []) latest = Math.max(latest, timestamp(comment.clickupCreatedAt), timestamp(comment.clickupUpdatedAt));
  for (const event of task.events ?? []) latest = Math.max(latest, timestamp(event.occurredAt));
  return latest;
}

export function compareRecentFirst<T extends RecencyTask>(a: T, b: T): number {
  return latestActivityTime(b) - latestActivityTime(a) || a.id - b.id;
}
