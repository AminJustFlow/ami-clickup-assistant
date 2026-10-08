import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import type { AgentState, RiskLevel, WaitingOnType } from '@prisma/client';
import { contextText, type TaskContext } from './context';
import { analyzeWithRules, type RuleIntelligence } from './engine';
import { TASK_ANALYZER_PROMPT_VERSION, TASK_ANALYZER_SYSTEM } from './prompt';
import { taskIntelligenceSchema, type TaskIntelligenceOutput } from './schema';
import { scoreRules } from './rules';

export const DEFAULT_INTELLIGENCE_MODEL = 'gpt-6-luna';

export type HybridIntelligence = RuleIntelligence & {
  source: 'AI' | 'RULES_FALLBACK';
  model: string | null;
  promptVersion: string;
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
  for (const comment of context.comments) {
    if (comment.authorName) internalNames.add(normalizedPerson(comment.authorName));
  }
  internalNames.add("ami d'amelio");
  internalNames.add('ami');

  if (type === 'CLIENT' && normalizedName && internalNames.has(normalizedName)) return 'Client';
  if (type === 'VENDOR' && normalizedName && internalNames.has(normalizedName)) return 'Vendor';
  if (type === 'TEAM' && (!normalizedName || normalizedName === 'client' || normalizedName === 'vendor')) return 'Team';
  return name;
}

function aiToHybrid(context: TaskContext, ai: TaskIntelligenceOutput, rules: RuleIntelligence, model: string, now: Date, teamNames: string[]): HybridIntelligence {
  let agentState = ai.agent_state as AgentState;
  let needsAmi = ai.needs_ami;
  let amiAction = ai.ami_action;
  let waitingOnType = ai.waiting_on_type as WaitingOnType;
  let waitingOnName = ai.waiting_on_name;

  const latestComment = context.comments.at(-1);
  if (needsAmi && latestComment && isAmiAuthor(latestComment.authorName)) {
    needsAmi = false;
    amiAction = null;
    if (agentState === 'WAITING_ON_AMI') agentState = 'ACTIVE';
    if (waitingOnType === 'AMI') {
      waitingOnType = 'NONE';
      waitingOnName = null;
    }
  }

  if (needsAmi) {
    agentState = 'WAITING_ON_AMI';
    waitingOnType = 'AMI';
    waitingOnName = 'Ami';
  } else if (agentState === 'WAITING_ON_AMI') {
    agentState = 'ACTIVE';
    waitingOnType = 'NONE';
    waitingOnName = null;
    amiAction = null;
  }

  if (waitingOnName && [...context.assignees, ...teamNames].some(n => normalizedPerson(n) === normalizedPerson(waitingOnName)) && (waitingOnType === 'CLIENT' || waitingOnType === 'VENDOR')) {\n    waitingOnType = 'TEAM';\n    agentState = 'WAITING_ON_TEAM';\n  }\n  waitingOnName = normalizeWaitingName(context, waitingOnType, waitingOnName, teamNames);

  const blocked = ['BLOCKED', 'ISSUE', 'WAITING_ON_VENDOR', 'WAITING_ON_CLIENT'].includes(agentState);
  const scores = scoreRules({
    priority: context.priority,
    dueDate: context.dueDate,
    needsAmi,
    blocked,
    lastMeaningfulActivity: rules.lastMeaningfulChangeAt
  }, now);

  return {
    meaningfulChange: ai.meaningful_change,
    agentState,
    headline: ai.headline,
    currentSummary: ai.current_summary,
    needsAmi,
    amiAction,
    waitingOnType,
    waitingOnName,
    importanceScore: Math.max(ai.importance, scores.importance),
    amiAttentionScore: scores.amiAttention,
    riskLevel: ai.risk as RiskLevel,
    lastMeaningfulChange: ai.last_meaningful_change || rules.lastMeaningfulChange,
    lastMeaningfulChangeAt: rules.lastMeaningfulChangeAt,
    confidence: ai.confidence,
    evidence: rules.evidence,
    source: 'AI',
    model,
    promptVersion: TASK_ANALYZER_PROMPT_VERSION
  };
}

export async function analyzeWithAI(
  context: TaskContext,
  options: { model?: string; now?: Date; client?: OpenAI; teamNames?: string[] } = {}
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

Internal agency employees (not clients or vendors): ${(options.teamNames ?? []).join(', ')}\n\n${contextText(context)}`,
      text: { format: zodTextFormat(taskIntelligenceSchema, 'task_intelligence') }
    });

    if (!response.output_parsed) throw new Error('OpenAI returned no parsed intelligence output.');
    return aiToHybrid(context, response.output_parsed, rules, model, now, options.teamNames ?? []);
  } catch (error) {
    console.warn(`AI analysis failed for task ${context.clickupTaskId}; using rules fallback:`, error instanceof Error ? error.message : error);
    return { ...rules, source: 'RULES_FALLBACK', model, promptVersion: 'RULE_ENGINE_V1' };
  }
}
