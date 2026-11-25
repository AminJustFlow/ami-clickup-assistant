import { handoffEvidence, type HandoffEvidence } from './handoff';
import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import type { AgentState, RiskLevel, WaitingOnType } from '@prisma/client';
import { contextText, type TaskContext } from './context';
import { relatedEvidenceText, type RelatedEvidence } from './related';
import { analyzeWithRules, type RuleIntelligence } from './engine';
import { TASK_ANALYZER_PROMPT_VERSION, TASK_ANALYZER_SYSTEM } from './prompt';
import { taskFieldIds, analyzerResponseSchema, taskAssessment, type TaskIntelligenceOutput } from './schema';

export const DEFAULT_INTELLIGENCE_MODEL = 'gpt-6-luna';

export type HybridIntelligence = RuleIntelligence & {
  source: 'AI' | 'RULES_FALLBACK';
  model: string | null;
  handoff?: HandoffEvidence;
  promptVersion: string;
  usage?: { inputTokens: number; outputTokens: number };
  nextActor?: string | null;
  unresolvedRequest?: string | null;
  priorityLevel?: string | null;
  priorityReasons?: string[];
  evidenceReferences?: TaskIntelligenceOutput['evidence_references'];
  contradictingEvidence?: TaskIntelligenceOutput['contradicting_evidence'];
  freshnessStatus?: string | null;
  verificationStatus?: string | null;
  verificationReasons?: string[];
  classificationVersion?: string | null;
};

function isAmiAuthor(name: string | null): boolean {
  const normalized = name?.toLowerCase().replace(/’/g, "'").trim() ?? '';
  return normalized === "ami d'amelio" || normalized === 'ami';
}

function normalizedPerson(name: string | null): string {
  return name?.toLowerCase().replace(/’/g, "'").trim() ?? '';
}

function normalizeWaitingName(context: TaskContext, type: WaitingOnType, name: string | null, teamNames: string[]): string | null {
  if (type === 'NONE') return null;
  if (type === 'AMI') return 'Ami';

  const normalizedName = normalizedPerson(name);
  const internalNames = new Set([...context.assignees, ...teamNames].map(normalizedPerson));
  // Comment authors can be clients or vendors; do not classify them as internal solely for commenting.
  internalNames.add("ami d'amelio");
  internalNames.add('ami');

  if (type === 'CLIENT' && normalizedName && internalNames.has(normalizedName)) return 'Client';
  if (type === 'VENDOR' && normalizedName && internalNames.has(normalizedName)) return 'Vendor';
  if (type === 'TEAM' && (!normalizedName || normalizedName === 'client' || normalizedName === 'vendor')) return 'Team';
  return name;
}

export function aiToHybrid(context: TaskContext, ai: TaskIntelligenceOutput, rules: RuleIntelligence, model: string, now: Date, teamNames: string[], related: RelatedEvidence[]): HybridIntelligence {
  let agentState = ai.agent_state as AgentState;
  let needsAmi = ai.needs_ami;
  let amiAction = ai.ami_action;
  let waitingOnType = ai.waiting_on_type as WaitingOnType;
  let waitingOnName = ai.waiting_on_name;
  const verificationReasons = ai.verification_status === 'VERIFY' ? [...ai.verification_reasons] : [];
  const commentsById = new Map(context.comments.map(comment => [String(comment.id), comment]));
  const allowedTaskFields = new Set<string>(taskFieldIds);
  const relatedTaskIds = new Set(related.map(item => item.context.clickupTaskId));
  const validReference = (reference: TaskIntelligenceOutput['evidence_references'][number]) => {
    if (reference.source_type === 'COMMENT') return commentsById.has(reference.source_id);
    if (reference.source_type === 'TASK_FIELD') return allowedTaskFields.has(reference.source_id);
    return reference.source_type === 'RELATED_TASK' && relatedTaskIds.has(reference.source_id);
  };
  const evidenceReferences = ai.evidence_references.filter(validReference);
  const contradictingEvidence = ai.contradicting_evidence.filter(validReference);
  for (const reference of [...ai.evidence_references, ...ai.contradicting_evidence]) {
    if (!validReference(reference)) {
      verificationReasons.push(`Unrecognized evidence reference: ${reference.source_type} ${reference.source_id}`);
    }
  }

  // Ami can have a pending decision even while the overall deliverable waits on
  // another teammate. Do not collapse two independent dependencies into one.
  // The model must resolve whether the request was answered using chronology.
  if (needsAmi && !amiAction?.trim()) {
    verificationReasons.push('No specific action for Ami');
  }
  if (needsAmi && ai.next_actor !== 'AMI') verificationReasons.push('The evidence does not clearly make Ami the next actor');
  if (needsAmi && !ai.unresolved_request?.trim()) verificationReasons.push('No concrete unresolved request was identified');
  if (needsAmi && evidenceReferences.length === 0) verificationReasons.push('No valid evidence supports the recommendation');
  if (needsAmi && ai.freshness_status !== 'CURRENT') verificationReasons.push('The recommendation may not reflect the current task state');
  if (needsAmi && ai.confidence < 0.8) verificationReasons.push('AI confidence is below the action-inbox threshold');
  if (needsAmi && agentState === 'WAITING_ON_AMI') {
    waitingOnType = 'AMI';
    waitingOnName = 'Ami';
  } else if (agentState === 'WAITING_ON_AMI') {
    // A decision is needed, but the model did not supply a valid action.
    agentState = 'ACTIVE';
    waitingOnType = 'NONE';
    waitingOnName = null;
  }
  if (!needsAmi) amiAction = null;

  if (waitingOnName && [...context.assignees, ...teamNames].some(n => normalizedPerson(n) === normalizedPerson(waitingOnName)) && (waitingOnType === 'CLIENT' || waitingOnType === 'VENDOR')) {
    waitingOnType = 'TEAM';
    agentState = 'WAITING_ON_TEAM';
  }
  waitingOnName = normalizeWaitingName(context, waitingOnType, waitingOnName, teamNames);

  const verificationStatus = verificationReasons.length || ai.verification_status === 'VERIFY' ? 'VERIFY' : 'VERIFIED';
  const priorityScore = needsAmi ? ai.priority_score : 0;

  return {
    meaningfulChange: ai.meaningful_change,
    agentState,
    headline: ai.headline,
    currentSummary: ai.current_summary,
    needsAmi,
    amiAction,
    waitingOnType,
    waitingOnName,
    importanceScore: ai.importance,
    amiAttentionScore: priorityScore,
    riskLevel: ai.risk as RiskLevel,
    lastMeaningfulChange: ai.last_meaningful_change || rules.lastMeaningfulChange,
    lastMeaningfulChangeAt: rules.lastMeaningfulChangeAt,
    confidence: ai.confidence,
    evidence: rules.evidence,
    nextActor: ai.next_actor,
    unresolvedRequest: ai.unresolved_request,
    priorityLevel: ai.priority_level,
    priorityReasons: ai.priority_reasons,
    evidenceReferences,
    contradictingEvidence,
    freshnessStatus: ai.freshness_status,
    verificationStatus,
    verificationReasons: [...new Set(verificationReasons)],
    classificationVersion: TASK_ANALYZER_PROMPT_VERSION,
    source: 'AI',
    model,
    promptVersion: TASK_ANALYZER_PROMPT_VERSION
  };
}

export async function analyzeWithAI(
  context: TaskContext,
  options: { model?: string; now?: Date; client?: OpenAI; teamNames?: string[]; related?: RelatedEvidence[]; idempotencyKey?: string } = {}
): Promise<HybridIntelligence> {
  const now = options.now ?? new Date();
  const rules = analyzeWithRules(context, now);
  const model = options.model ?? process.env.OPENAI_INTELLIGENCE_MODEL ?? DEFAULT_INTELLIGENCE_MODEL;

  if (!process.env.OPENAI_API_KEY && !options.client) {
    return { ...rules, source: 'RULES_FALLBACK', model: null, promptVersion: 'RULE_ENGINE_V1' };
  }

  try {
    const client = options.client ?? new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.responses.parse({
      model,
      instructions: TASK_ANALYZER_SYSTEM,
      input: `Analyze the current operational state of this ClickUp task. Comments are chronological, oldest to newest.

Internal agency employees (not clients or vendors): ${(options.teamNames ?? []).join(', ')}

${contextText(context)}

Related task evidence (independent scope; do not assume shared completion):
${relatedEvidenceText(options.related ?? []) || 'No strongly related tasks identified.'}`,
      text: { format: zodTextFormat(analyzerResponseSchema, 'task_intelligence') }
    }, options.idempotencyKey ? { headers: { 'Idempotency-Key': options.idempotencyKey } } : undefined);

    if (!response.output_parsed) throw new Error('OpenAI returned no parsed intelligence output.');
    return {
      ...aiToHybrid(context, taskAssessment(response.output_parsed), rules, model, now, options.teamNames ?? [], options.related ?? []),
      handoff: handoffEvidence(context.comments, response.output_parsed.dependency_change_comment),
      usage: { inputTokens: response.usage?.input_tokens ?? 0, outputTokens: response.usage?.output_tokens ?? 0 }
    };
  } catch (error) {
    console.warn(`AI analysis failed for task ${context.clickupTaskId}; using rules fallback:`, error instanceof Error ? error.message : error);
    return { ...rules, source: 'RULES_FALLBACK', model, promptVersion: 'RULE_ENGINE_V1' };
  }
}
