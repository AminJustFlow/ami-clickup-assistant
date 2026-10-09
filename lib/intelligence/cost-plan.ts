import { prisma } from '../db/prisma';
import { analysisClientGroups } from './client-scope';
import { buildTaskContext, contextText } from './context';
import { findRelatedTasks, relatedEvidenceText } from './related';
import { intelligenceFingerprint } from './fingerprint';
import { DEFAULT_INTELLIGENCE_MODEL } from './ai';
import { TASK_ANALYZER_PROMPT_VERSION, TASK_ANALYZER_SYSTEM } from './prompt';
import { taskIntelligenceSchema } from './schema';

export type CostOptions = {
  clientSlug?: string;
  includeVoth?: boolean;
  inputRate: number;
  outputRate: number;
  outputTokens: number;
  charsPerToken: number;
  inputSafetyMultiplier: number;
};
export type CostRow = {
  client: string;
  slug: string;
  imported: number;
  cached: number;
  pending: number;
  comments: number;
  attachments: number;
  checklists: number;
  customFields: number;
  checklistItems: number;
  linkedTasks: number;
  dependencies: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedUSD: number;
  largestTaskTokens: number;
};
export type CostPlan = { model: string; rows: CostRow[]; pending: number; cached: number; estimatedUSD: number; estimatedInputTokens: number; estimatedOutputTokens: number; maxTaskInputTokens: number };

export function parseCostOptions(args: string[]): CostOptions {
  const value = (flag: string) => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; };
  const inputRate = Number(value('--input-rate') ?? process.env.AI_INPUT_USD_PER_MILLION ?? NaN);
  const outputRate = Number(value('--output-rate') ?? process.env.AI_OUTPUT_USD_PER_MILLION ?? NaN);
  const outputTokens = Number(value('--output-tokens') ?? '1500');
  const charsPerToken = Number(value('--chars-per-token') ?? '3');
  const inputSafetyMultiplier = Number(value('--input-safety') ?? '1.25');
  if (![inputRate, outputRate].every(n => Number.isFinite(n) && n >= 0)) {
    throw new Error('Set explicit current model prices: --input-rate USD_PER_MILLION --output-rate USD_PER_MILLION (or AI_INPUT_USD_PER_MILLION and AI_OUTPUT_USD_PER_MILLION). Pricing is not fetched automatically.');
  }
  if (!Number.isInteger(outputTokens) || outputTokens < 1 || !Number.isFinite(charsPerToken) || charsPerToken <= 0 || !Number.isFinite(inputSafetyMultiplier) || inputSafetyMultiplier < 1) {
    throw new Error('Invalid output-tokens, chars-per-token, or input-safety');
  }
  return { clientSlug: value('--client'), includeVoth: args.includes('--include-voth'), inputRate, outputRate, outputTokens, charsPerToken, inputSafetyMultiplier };
}

export async function calculateCostPlan(options: CostOptions): Promise<CostPlan> {
  const model = process.env.OPENAI_INTELLIGENCE_MODEL ?? DEFAULT_INTELLIGENCE_MODEL;
  const expectedVersion = TASK_ANALYZER_PROMPT_VERSION + ':' + model;
  const clients = await analysisClientGroups(options);
  const teamNames = (await prisma.employee.findMany({ select: { name: true } })).map(e => e.name);
  const rows: CostRow[] = [];
  // Include schema size and system instructions. These are approximations, not API token counts.
  const sharedChars = TASK_ANALYZER_SYSTEM.length + JSON.stringify(taskIntelligenceSchema.shape).length + 1000;
  for (const client of clients) {
    const tasks = await prisma.task.findMany({
      where: { clientId: { in: client.folders.map(folder => folder.id) }, deleted: false },
      include: { list: true, intelligence: true, assignees: { include: { employee: true } }, comments: { orderBy: { clickupCreatedAt: 'asc' } } }
    });
    const contexts = tasks.map(buildTaskContext);
    const row: CostRow = { client: client.canonical.name, slug: client.canonical.slug, imported: tasks.length, cached: 0, pending: 0, comments: 0, attachments: 0, checklists: 0, customFields: 0, checklistItems: 0, linkedTasks: 0, dependencies: 0, estimatedInputTokens: 0, estimatedOutputTokens: 0, estimatedUSD: 0, largestTaskTokens: 0 };
    for (const task of tasks) {
      row.comments += task.comments.length;
      const context = buildTaskContext(task);
      row.attachments += context.coverage.attachments;
      row.checklists += context.coverage.checklistCount;
      row.checklistItems += context.coverage.checklistItems;
      row.customFields += context.coverage.customFields;
      row.linkedTasks += context.coverage.linkedTasks;
      row.dependencies += context.coverage.dependencies;
      const related = findRelatedTasks(context, contexts);
      const fingerprint = intelligenceFingerprint(context, model, teamNames, related);
      if (task.intelligence?.sourceFingerprint === fingerprint && task.intelligence.promptVersion === expectedVersion) { row.cached++; continue; }
      const payload = [
        'Analyze the current operational state of this ClickUp task. Comments are chronological, oldest to newest.',
        'Internal agency employees (not clients or vendors): ' + teamNames.join(', '),
        contextText(context),
        'Related task evidence (independent scope; do not assume shared completion):',
        relatedEvidenceText(related) || 'No strongly related tasks identified.'
      ].join('\n\n');
      const input = Math.ceil(((payload.length + sharedChars) / options.charsPerToken) * options.inputSafetyMultiplier);
      row.pending++;
      row.estimatedInputTokens += input;
      row.estimatedOutputTokens += options.outputTokens;
      row.largestTaskTokens = Math.max(row.largestTaskTokens, input);
    }
    row.estimatedUSD = (row.estimatedInputTokens * options.inputRate + row.estimatedOutputTokens * options.outputRate) / 1_000_000;
    rows.push(row);
  }
  return {
    model, rows,
    pending: rows.reduce((n, r) => n + r.pending, 0),
    cached: rows.reduce((n, r) => n + r.cached, 0),
    estimatedUSD: rows.reduce((n, r) => n + r.estimatedUSD, 0),
    estimatedInputTokens: rows.reduce((n, r) => n + r.estimatedInputTokens, 0),
    estimatedOutputTokens: rows.reduce((n, r) => n + r.estimatedOutputTokens, 0),
    maxTaskInputTokens: Math.max(0, ...rows.map(r => r.largestTaskTokens))
  };
}

export function printCostPlan(plan: CostPlan, options: CostOptions) {
  console.log('\nAI PRE-FLIGHT COST ESTIMATE (NO API REQUESTS)');
  console.log('Model: ' + plan.model);
  console.log('Rates: $' + options.inputRate + '/M input; $' + options.outputRate + '/M output; expected ' + options.outputTokens + ' output tokens/task');
  console.log('Assumptions: ' + options.charsPerToken + ' chars/input token, ' + options.inputSafetyMultiplier + 'x input safety multiplier');
  for (const r of plan.rows) console.log(r.client + ' [' + r.slug + '] · ' + r.imported + ' imported · ' + r.comments + ' comments · ' + r.attachments + ' attachment refs · ' + r.checklists + ' checklists (' + r.checklistItems + ' items) · ' + r.customFields + ' custom fields · ' + r.dependencies + ' dependencies · ' + r.linkedTasks + ' links · ' + r.pending + ' AI calls · ' + r.cached + ' cached · $' + r.estimatedUSD.toFixed(4) + ' estimated');
  console.log('TOTAL: ' + plan.pending + ' pending calls, ' + plan.cached + ' cached, ~' + plan.estimatedInputTokens.toLocaleString() + ' input tokens, ~' + plan.estimatedOutputTokens.toLocaleString() + ' output tokens, $' + plan.estimatedUSD.toFixed(2) + ' estimated');
  console.log('EVIDENCE COVERAGE: ' + plan.rows.reduce((n,r) => n+r.comments,0) + ' comments, ' + plan.rows.reduce((n,r) => n+r.checklistItems,0) + ' checklist items, ' + plan.rows.reduce((n,r) => n+r.customFields,0) + ' custom field entries, ' + plan.rows.reduce((n,r) => n+r.attachments,0) + ' attachment references, ' + plan.rows.reduce((n,r) => n+r.dependencies,0) + ' dependencies.');
  console.log('Largest estimated task input: ' + plan.maxTaskInputTokens.toLocaleString() + ' tokens (check model context limit).');
  console.log('WARNING: This is a conservative character-based approximation, NOT a quote or hard spending cap. Actual tokenization, reasoning/output tokens, retries, and provider rates may differ.');
  console.log('Client scope: related ClickUp folders are consolidated by verified IDs or unique client codes; tasks remain in their original folders. Dependency task IDs now prioritize cross-task evidence within each group.');
  console.log('Coverage: all imported task descriptions and chronological comments are included in the primary task context. Related-task excerpts are limited by the current analyzer. Checklist items, custom field values, dependency references and attachment metadata ARE now included when present in the stored raw task. Attachment FILE CONTENTS, external linked documents, full time entries, and activity outside imported comments are NOT included. Zero attachment references may indicate incomplete list-task API payloads; run npm run clickup:audit-detail to compare with full task API.');
}
