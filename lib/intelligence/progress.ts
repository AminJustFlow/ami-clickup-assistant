/**
 * Evidence-based progress signal. This is deliberately conservative:
 * ClickUp updatedAt alone never proves work advanced.
 */
export function progressSignal(input: {
  agentState: string;
  clickupStatus: string | null;
  comments: { body: string; clickupCreatedAt: Date | null }[];
  lastMeaningfulChangeAt: Date | null;
  lastMeaningfulChange: string | null;
}, now = new Date()): { label: string; detail: string; kind: 'confirmed' | 'followup' | 'unknown' } {
  const recent = (date: Date | null) => date !== null && Number.isFinite(date.getTime()) &&
    date.getTime() <= now.getTime() && date.getTime() >= now.getTime() - 30 * 86400000;
  if (input.agentState === 'COMPLETED') {
    return { kind: 'confirmed', label: 'Completion reported', detail: 'Operational intelligence indicates completion; verify in ClickUp if needed.' };
  }
  if (input.agentState.startsWith('WAITING_') || input.agentState === 'BLOCKED' || input.agentState === 'ISSUE') {
    return { kind: 'followup', label: 'Needs follow-up', detail: 'An unresolved dependency or issue is recorded.' };
  }
  const latest = [...input.comments].filter(c => recent(c.clickupCreatedAt))
    .sort((a,b) => (b.clickupCreatedAt?.getTime() ?? 0) - (a.clickupCreatedAt?.getTime() ?? 0))[0];
  if (latest && /\b(?:completed|finished|published|launched|fixed|resolved|implemented|uploaded|delivered|sent to (?:client|printer)|all set)\b/i.test(latest.body)) {
    return { kind: 'confirmed', label: 'Progress reported', detail: 'Recent comment describes a concrete milestone. This does not necessarily complete the task.' };
  }
  if (recent(input.lastMeaningfulChangeAt) && input.lastMeaningfulChange && input.comments.length > 0) {
    return { kind: 'unknown', label: 'Change recorded', detail: 'A recent meaningful change was identified, but progress is not independently confirmed.' };
  }
  return { kind: 'unknown', label: 'Progress unverified', detail: 'Recent task updates alone do not demonstrate progress.' };
}
