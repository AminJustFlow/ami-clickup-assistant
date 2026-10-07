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

const completion = /\b(all set|completed?|done|published|live|fixed|resolved|good to go|finished|files are finalized)\b/i;
const issue = /\b(error|issue|problem|broken|not working|still (?:not|asking|failing)|blocked|can't|cannot|unable)\b/i;
const explicitClientReview = /\b(?:sent|submitted|forwarded)\b.{0,45}\b(?:client|cap|capstone|christen|stephanie|erika|rayshonda|caitlin)\b.{0,35}\b(?:for review|for approval|to review|to approve)\b|\b(?:client|cap|capstone|christen|stephanie|erika|rayshonda|caitlin)\b.{0,35}\b(?:review|approval|approve)\b/i;
const explicitWait = /\b(?:waiting|still waiting) (?:to hear|on|for)\b|\b(?:hear|get) back\b|\bonce i hear back\b|\bpending (?:with|from)\b/i;
const reachedOut = /\b(?:reached out|followed up|left .{0,20}(?:voicemail|message)|emailed|contacted)\b/i;
const vendorHandoff = /\b(?:sent|submitted|forwarded) (?:this|it|one)?\s*(?:over )?to (fluentbooking|eaglenet|spectrum|google|microsoft|meta|paypal|rent manager|engrain)\b/i;
const vendorDependency = /\b(?:waiting|pending|hear back|get back|reached out|followed up)\b.{0,100}\b(fluentbooking|eaglenet|spectrum|google|microsoft|meta|paypal|rent manager|engrain|support|web team)\b|\b(fluentbooking|eaglenet|spectrum|google|microsoft|meta|paypal|rent manager|engrain|support|web team)\b.{0,100}\b(?:waiting|pending|hear back|get back|reached out|followed up)\b/i;
const clientDependency = /\b(?:waiting|pending|hear back|get back|reached out|followed up|voicemail|emailed)\b.{0,100}\b(client|customer|cap|capstone|christen|stephanie|erika|rayshonda|caitlin|kristen)\b|\b(client|customer|cap|capstone|christen|stephanie|erika|rayshonda|caitlin|kristen)\b.{0,100}\b(?:waiting|pending|hear back|get back|reached out|followed up|voicemail|emailed)\b/i;
const amiDirectRequest = /(?:@ami\s+d['’]?amelio|\bami\s+d['’]?amelio\b).{0,90}\b(can you|could you|please|what do you think|what are your thoughts|your thoughts|let me know|confirm|approve|review|take a look|do you want|would you like)\b|\b(can you|could you|please|what do you think|what are your thoughts|your thoughts|let me know|confirm|approve|review|take a look|do you want|would you like)\b.{0,90}(?:@ami\s+d['’]?amelio|\bami\s+d['’]?amelio\b)/i;

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function knownVendor(text: string): string | null {
  const names = ['FluentBooking', 'Eaglenet', 'Spectrum', 'Google', 'Microsoft', 'Meta', 'PayPal', 'Rent Manager', 'Engrain'];
  return names.find((name) => new RegExp(`\\b${name.replace(' ', '\\s+')}\\b`, 'i').test(text)) ?? null;
}

function clearAmi() {
  return { needsAmi: false, amiAction: null as string | null };
}

export function analyzeWithRules(context: TaskContext, now = new Date()): RuleIntelligence {
  const evidence: IntelligenceEvidence[] = [];
  const clickupDone = ['done', 'closed', 'complete', 'completed'].includes(context.status?.toLowerCase() ?? '');
  let state: AgentState = clickupDone ? 'COMPLETED' : context.comments.length ? 'ACTIVE' : 'UNKNOWN';
  let waitingOnType: WaitingOnType = 'NONE';
  let waitingOnName: string | null = null;
  let needsAmi = false;
  let amiAction: string | null = null;
  let confidence = context.comments.length ? 0.68 : clickupDone ? 0.82 : 0.5;
  let lastMeaningfulChangeAt: Date | null = null;
  let lastMeaningfulChange: string | null = null;

  for (const comment of context.comments) {
    const text = clean(comment.body);
    let meaningful = false;

    if (completion.test(text)) {
      state = 'COMPLETED';
      waitingOnType = 'NONE';
      waitingOnName = null;
      ({ needsAmi, amiAction } = clearAmi());
      evidence.push({ kind: 'completion', commentId: comment.id, text });
      meaningful = true;
      confidence = Math.max(confidence, 0.86);
    }

    const vendor = knownVendor(text);
    const isVendorWait = Boolean(vendorHandoff.test(text) || vendorDependency.test(text));
    const isClientWait = explicitClientReview.test(text) || clientDependency.test(text);
    const isUnspecifiedWait = (explicitWait.test(text) || reachedOut.test(text)) && !isVendorWait && !isClientWait;

    if (isVendorWait) {
      state = 'WAITING_ON_VENDOR';
      waitingOnType = 'VENDOR';
      waitingOnName = vendor ?? 'Vendor';
      ({ needsAmi, amiAction } = clearAmi());
      evidence.push({ kind: 'waiting', commentId: comment.id, text });
      meaningful = true;
      confidence = Math.max(confidence, 0.88);
    } else if (isClientWait) {
      state = 'WAITING_ON_CLIENT';
      waitingOnType = 'CLIENT';
      waitingOnName = 'Client';
      ({ needsAmi, amiAction } = clearAmi());
      evidence.push({ kind: 'waiting', commentId: comment.id, text });
      meaningful = true;
      confidence = Math.max(confidence, 0.86);
    } else if (isUnspecifiedWait) {
      state = 'BLOCKED';
      waitingOnType = 'OTHER';
      waitingOnName = null;
      ({ needsAmi, amiAction } = clearAmi());
      evidence.push({ kind: 'waiting', commentId: comment.id, text });
      meaningful = true;
      confidence = Math.max(confidence, 0.7);
    }

    if (issue.test(text) && !isVendorWait && !isClientWait && !isUnspecifiedWait) {
      state = 'ISSUE';
      waitingOnType = 'NONE';
      waitingOnName = null;
      evidence.push({ kind: 'issue', commentId: comment.id, text });
      meaningful = true;
      confidence = Math.max(confidence, 0.74);
    }

    if (amiDirectRequest.test(text) && comment.authorName?.toLowerCase().includes('ami') !== true) {
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
    state === 'BLOCKED' ? 'Waiting on an external dependency' :
    state === 'UNKNOWN' ? 'Operational state is unclear' :
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
