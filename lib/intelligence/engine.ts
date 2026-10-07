import type { AgentState, RiskLevel, WaitingOnType } from '@prisma/client';
import type { TaskContext } from './context';
import { scoreRules } from './rules';

export type IntelligenceEvidence = {
  kind: 'completion' | 'waiting' | 'ami_action' | 'issue' | 'review' | 'status';
  commentId?: number;
  text: string;
};

export type RuleIntelligence = {
  meaningfulChange: boolean;
  agentState: AgentState;
  headline: string;
  currentSummary: string;
  needsAmi: boolean;
  amiAction: string | null;
  waitingOnType: WaitingOnType;
  waitingOnName: string | null;
  importanceScore: number;
  amiAttentionScore: number;
  riskLevel: RiskLevel;
  lastMeaningfulChange: string | null;
  lastMeaningfulChangeAt: Date | null;
  confidence: number;
  evidence: IntelligenceEvidence[];
};

const completion = /\b(all set|completed?|done|published|live|fixed|resolved|good to go|finished)\b/i;
const issue = /\b(error|issue|problem|broken|not working|still (?:not|asking|failing)|blocked|can't|cannot|unable)\b/i;
const review = /\b(sent .{0,30} for review|for review|please review|needs review|review and approve|approval)\b/i;
const externalWait = /\b(reached out|followed up|sent (?:this|it|one)?\s*to|waiting (?:to hear|on|for)|hear back|once i hear back|pending (?:with|from))\b/i;
const amiRequest = /(?:@ami\b|\bami\b).{0,120}\b(can you|could you|please|what do you think|confirm|approve|review|let me know|do you want)\b|\b(can you|could you|please|what do you think|confirm|approve|review)\b.{0,120}(?:@ami\b|\bami\b)/i;
const clientWait = /\b(client|customer|capstone|christen|stephanie|erika|rayshonda|caitlin)\b/i;
const vendorWait = /\b(support|vendor|fluentbooking|eaglenet|spectrum|google|microsoft|meta|paypal)\b/i;

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function waitingName(text: string, type: WaitingOnType): string | null {
  const known = ['FluentBooking', 'Eaglenet', 'Spectrum', 'Google', 'Microsoft', 'Meta', 'PayPal'];
  const match = known.find((name) => new RegExp(`\\b${name}\\b`, 'i').test(text));
  if (match) return match;
  if (type === 'CLIENT') return 'Client';
  if (type === 'AMI') return 'Ami';
  return null;
}

export function analyzeWithRules(context: TaskContext, now = new Date()): RuleIntelligence {
  const evidence: IntelligenceEvidence[] = [];
  let state: AgentState = context.status?.toLowerCase() === 'done' || context.status?.toLowerCase() === 'closed' ? 'COMPLETED' : 'ACTIVE';
  let waitingOnType: WaitingOnType = 'NONE';
  let waitingOnName: string | null = null;
  let needsAmi = false;
  let amiAction: string | null = null;
  let confidence = context.comments.length ? 0.72 : 0.58;
  let lastMeaningfulChangeAt: Date | null = null;
  let lastMeaningfulChange: string | null = null;

  for (const comment of context.comments) {
    const text = clean(comment.body);
    let meaningful = false;

    if (completion.test(text)) {
      state = 'COMPLETED';
      waitingOnType = 'NONE';
      waitingOnName = null;
      evidence.push({ kind: 'completion', commentId: comment.id, text });
      meaningful = true;
      confidence = Math.max(confidence, 0.86);
    }

    if (externalWait.test(text)) {
      const type: WaitingOnType = vendorWait.test(text) ? 'VENDOR' : clientWait.test(text) ? 'CLIENT' : 'OTHER';
      state = type === 'VENDOR' ? 'WAITING_ON_VENDOR' : type === 'CLIENT' ? 'WAITING_ON_CLIENT' : 'BLOCKED';
      waitingOnType = type;
      waitingOnName = waitingName(text, type);
      evidence.push({ kind: 'waiting', commentId: comment.id, text });
      meaningful = true;
      confidence = Math.max(confidence, type === 'OTHER' ? 0.74 : 0.88);
    }

    if (review.test(text) && !externalWait.test(text)) {
      state = clientWait.test(text) ? 'WAITING_ON_CLIENT' : 'NEEDS_REVIEW';
      waitingOnType = clientWait.test(text) ? 'CLIENT' : 'OTHER';
      waitingOnName = waitingName(text, waitingOnType);
      evidence.push({ kind: 'review', commentId: comment.id, text });
      meaningful = true;
    }

    if (issue.test(text) && !externalWait.test(text)) {
      state = 'ISSUE';
      evidence.push({ kind: 'issue', commentId: comment.id, text });
      meaningful = true;
    }

    if (amiRequest.test(text)) {
      needsAmi = true;
      state = 'WAITING_ON_AMI';
      waitingOnType = 'AMI';
      waitingOnName = 'Ami';
      amiAction = text.slice(0, 300);
      evidence.push({ kind: 'ami_action', commentId: comment.id, text });
      meaningful = true;
      confidence = Math.max(confidence, 0.9);
    }

    if (meaningful) {
      lastMeaningfulChange = text;
      lastMeaningfulChangeAt = comment.createdAt;
    }
  }

  const blocked = ['BLOCKED', 'ISSUE', 'WAITING_ON_VENDOR', 'WAITING_ON_CLIENT'].includes(state);
  const scores = scoreRules({
    priority: context.priority,
    dueDate: context.dueDate,
    needsAmi,
    blocked,
    lastMeaningfulActivity: lastMeaningfulChangeAt
  }, now);

  const riskLevel: RiskLevel =
    needsAmi && context.dueDate && context.dueDate < now ? 'HIGH' :
    state === 'ISSUE' || state === 'BLOCKED' ? 'MEDIUM' : 'LOW';

  const headline =
    state === 'WAITING_ON_VENDOR' ? `Waiting on ${waitingOnName ?? 'vendor'}` :
    state === 'WAITING_ON_CLIENT' ? 'Waiting on client' :
    state === 'WAITING_ON_AMI' ? 'Needs Ami action' :
    state === 'COMPLETED' ? 'Work appears complete' :
    state === 'ISSUE' ? 'Issue needs attention' :
    state === 'NEEDS_REVIEW' ? 'Review is pending' :
    'Work is active';

  return {
    meaningfulChange: evidence.length > 0,
    agentState: state,
    headline,
    currentSummary: lastMeaningfulChange ?? `${context.name} is ${state.toLowerCase().replaceAll('_', ' ')}.`,
    needsAmi,
    amiAction,
    waitingOnType,
    waitingOnName,
    importanceScore: scores.importance,
    amiAttentionScore: scores.amiAttention,
    riskLevel,
    lastMeaningfulChange,
    lastMeaningfulChangeAt,
    confidence,
    evidence
  };
}
