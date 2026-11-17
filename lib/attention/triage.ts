/** Shared active-decision rules for the dashboard and the Needs Ami inbox. */
export type AttentionSnapshot = {
  needsAmi: boolean;
  agentState: string;
  sourceFingerprint: string | null;
  analyzedAt: Date | null;
  verificationStatus?: string | null;
  verificationReasons?: unknown;
  evidenceReferences?: unknown;
  freshnessStatus?: string | null;
  nextActor?: string | null;
  unresolvedRequest?: string | null;
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

/** Use outside the dedicated verification inbox so uncertain AI output is never presented as fact. */
export function isVerifiedOpenAttentionTask(task: {
  clickupStatus: string | null;
  intelligence: AttentionSnapshot | null;
  attentionDisposition: AttentionDispositionSnapshot;
}): boolean {
  return task.intelligence?.verificationStatus === 'VERIFIED' && isOpenAttentionTask(task);
}

/**
 * Reject non-actions that occasionally appear in model output. Keep this narrow:
 * do not second-guess legitimate human-readable instructions.
 */
export function hasSpecificAmiAction(action: string | null): boolean {
  const value = action?.trim() ?? '';
  if (!value) return false;
  // These are status summaries or generic prompts, not decisions Ami can act on.
  // Keep this conservative: a concrete instruction with context must remain valid.
  const normalized = value.toLowerCase().replace(/[.!]+$/, '').trim();
  if (!normalized || /^[-–—]+$/.test(normalized)) return false;
  const genericActions = new Set([
    'n/a', 'none', 'unknown', 'tbd', 'to be determined',
    'no action', 'no action needed', 'no action required', 'not applicable',
    'review', 'check', 'follow up', 'follow-up', 'monitor', 'investigate',
    'look into', 'take action', 'needs attention', 'action required',
    'awaiting update', 'awaiting response', 'awaiting feedback', 'look into this'
  ]);
  if (genericActions.has(normalized)) return false;
  const genericTargets = ['task', 'item', 'issue', 'status', 'situation', 'project', 'details', 'progress', 'update', 'updates'];
  const genericVerbs = ['review', 'check', 'follow up', 'follow-up', 'monitor', 'investigate', 'look into'];
  for (const verb of genericVerbs) {
    for (const target of genericTargets) {
      if (normalized === verb + ' ' + target || normalized === verb + ' the ' + target || normalized === verb + ' this ' + target) return false;
    }
  }
  return true;

}

/** Reasons to verify an AI recommendation before treating it as a current decision. */
export function attentionVerificationReasons(task: {
  clickupUpdatedAt: Date | null;
  intelligence: {
    analyzedAt: Date | null;
    confidence: number | null;
    needsAmi: boolean;
    amiAction: string | null;
    verificationStatus?: string | null;
    verificationReasons?: unknown;
    evidenceReferences?: unknown;
    freshnessStatus?: string | null;
    nextActor?: string | null;
    unresolvedRequest?: string | null;
  } | null;
}): string[] {
  const intel = task.intelligence;
  if (!intel) return ['No AI analysis'];
  const reasons: string[] = [];
  // Allow minor timestamp drift between ClickUp ingestion and analysis persistence.
  if (!intel.analyzedAt) reasons.push('Analysis timestamp unavailable');
  else if (task.clickupUpdatedAt && task.clickupUpdatedAt.getTime() > intel.analyzedAt.getTime() + 120_000)
    reasons.push('ClickUp changed after the AI analysis');
  if (intel.confidence == null || !Number.isFinite(intel.confidence) || intel.confidence < 0.75 || intel.confidence > 1)
    reasons.push('Low or unknown AI confidence');
  if (intel.needsAmi && !hasSpecificAmiAction(intel.amiAction))
    reasons.push('No specific action for Ami');
  if (intel.needsAmi && intel.verificationStatus !== 'VERIFIED') reasons.push('The recommendation has not passed evidence verification');
  if (intel.needsAmi && intel.nextActor !== 'AMI') reasons.push('Ami is not clearly identified as the next actor');
  if (intel.needsAmi && !intel.unresolvedRequest?.trim()) reasons.push('No concrete unresolved request was identified');
  if (intel.needsAmi && (!Array.isArray(intel.evidenceReferences) || intel.evidenceReferences.length === 0)) reasons.push('No traceable evidence supports the recommendation');
  if (intel.needsAmi && intel.freshnessStatus !== 'CURRENT') reasons.push('Recommendation freshness is uncertain');
  if (Array.isArray(intel.verificationReasons)) {
    for (const reason of intel.verificationReasons) if (typeof reason === 'string' && reason.trim()) reasons.push(reason.trim());
  }
  return [...new Set(reasons)];
}
