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

/** Reasons to verify an AI recommendation before treating it as a current decision. */
export function attentionVerificationReasons(task: {
  clickupUpdatedAt: Date | null;
  intelligence: {
    analyzedAt: Date | null;
    confidence: number | null;
    needsAmi: boolean;
    amiAction: string | null;
  } | null;
}): string[] {
  const intel = task.intelligence;
  if (!intel) return ['No AI analysis'];
  const reasons: string[] = [];
  // Allow minor timestamp drift between ClickUp ingestion and analysis persistence.
  if (!intel.analyzedAt) reasons.push('Analysis timestamp unavailable');
  else if (task.clickupUpdatedAt && task.clickupUpdatedAt.getTime() > intel.analyzedAt.getTime() + 120_000)
    reasons.push('ClickUp changed after the AI analysis');
  if (intel.confidence == null || intel.confidence < 0.75)
    reasons.push('Low or unknown AI confidence');
  if (intel.needsAmi && !intel.amiAction?.trim())
    reasons.push('No specific action for Ami');
  return reasons;
}
