export function clickupDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const milliseconds = Number(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds) : null;
}

export function commentPlainText(comment: Record<string, unknown>): string {
  if (typeof comment.comment_text === 'string') return comment.comment_text;
  const fragments = Array.isArray(comment.comment_text) ? comment.comment_text : Array.isArray(comment.comment) ? comment.comment : [];
  return fragments.map((fragment) => {
    if (typeof fragment === 'string') return fragment;
    if (!fragment || typeof fragment !== 'object') return '';
    const part = fragment as Record<string, unknown>;
    if (typeof part.text === 'string') return part.text;
    if (typeof part.username === 'string') return `@${part.username}`;
    return '';
  }).join('');
}

export function isClosedTask(task: Record<string, any>): boolean {
  const type = String(task.status?.type ?? '').toLowerCase();
  const status = String(task.status?.status ?? '').toLowerCase();
  return type === 'closed' || /^(closed|complete|completed|done)$/.test(status);
}
