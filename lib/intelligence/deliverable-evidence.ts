type TaskSources = {
  comments: {
    id: number;
    body: string;
    authorName: string | null;
    clickupCreatedAt: Date | null;
    clickupUpdatedAt: Date | null;
  }[];
  events: { occurredAt: Date | null; beforeValue: unknown; afterValue: unknown }[];
};

function statusValue(payload: unknown): string | undefined {
  if (payload && typeof payload === 'object' && 'value' in payload && typeof payload.value === 'string') {
    return payload.value.trim() || undefined;
  }
}

export function latestDeliverableEvidence(task: TaskSources, sharedCommentId: number) {
  let latest: { at: Date; source: string; text: string } | null = null;
  for (const event of task.events) {
    const from = statusValue(event.beforeValue);
    const to = statusValue(event.afterValue);
    if (!from || !to || from === to || !event.occurredAt || (latest && event.occurredAt <= latest.at)) continue;
    latest = { at: event.occurredAt, source: 'ClickUp sync', text: `Observed status change from ${from} to ${to}.` };
  }
  for (const comment of task.comments) {
    const edited = comment.clickupUpdatedAt && (!comment.clickupCreatedAt || comment.clickupUpdatedAt > comment.clickupCreatedAt);
    const at = edited ? comment.clickupUpdatedAt : comment.clickupCreatedAt;
    if (!at || comment.id === sharedCommentId || (latest && at < latest.at)) continue;
    const text = comment.body.trim().replace(/\s+/g, ' ');
    if (!text || /^(?:Task Comment preview \d+|https?:\/\/\S+|thanks|thank you|ok(?:ay)?|noted)[.!\s]*$/i.test(text)) continue;
    let excerpt = text;
    if (text.length > 220) {
      const preview = text.slice(0, 217).split(/\s+(?:https?:\/\/|Dropbox-JustFlow\/)/i)[0];
      excerpt = (preview.length === 217 ? preview.replace(/\s+\S*$/, '') : preview).trimEnd() + '…';
    }
    const source = comment.authorName?.trim() || 'ClickUp';
    latest = { at, source: `${source} · ${edited ? 'edited comment' : 'comment'}`, text: excerpt };
  }
  return latest;
}
