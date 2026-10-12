/** Shared active-decision rules for the dashboard and the Needs Ami inbox. */
export type AttentionSnapshot = {
  needsAmi: boolean;
  agentState: string;
  sourceFingerprint: string | null;
  analyzedAt: Date | null;
};
export type AttentionDispositionSnapshot = {
  sourceFingerprint: string;
  decision: string;
} | null;

export function attentionFingerprint(intel: Pick<AttentionSnapshot, 'sourceFingerprint' | 'analyzedAt'>): string {
  return intel.sourceFingerprint ?? `analyzed:${intel.analyzedAt?.toISOString() ?? 'unknown'}`;
}

export function isClosedClickUpStatus(status: string | null): boolean {
  return /^(done|complete|completed|closed|cancelled|canceled)$/i.test(status?.trim() ?? '');
}

export function isOpenAttentionTask(task: {
  clickupStatus: string | null;
  intelligence: AttentionSnapshot | null;
  attentionDisposition: AttentionDispositionSnapshot;
}): boolean {
  const intel = task.intelligence;
  if (!intel?.needsAmi || intel.agentState === 'COMPLETED' || isClosedClickUpStatus(task.clickupStatus)) return false;
  return task.attentionDisposition?.sourceFingerprint !== attentionFingerprint(intel);
}
