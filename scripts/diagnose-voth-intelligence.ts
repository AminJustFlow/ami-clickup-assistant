import { loadEnvConfig } from '@next/env';
import { prisma } from '../lib/db/prisma';
import { buildTaskContext } from '../lib/intelligence/context';
import { analyzeWithRules } from '../lib/intelligence/engine';

const INTERESTING_STATES = new Set([
  'BLOCKED',
  'ISSUE',
  'NEEDS_REVIEW',
  'WAITING_ON_CLIENT',
  'WAITING_ON_VENDOR',
  'WAITING_ON_AMI'
]);

const AMI_MENTION = /(?:@ami\b|\bami\s+d['’]?amelio\b|\bami\b)/i;
const ACTION_LANGUAGE = /\b(can you|could you|please|what do you think|thoughts\??|let me know|confirm|approve|approval|review|take a look|check|do you want|would you like|need you|your call|your thoughts|recommend|decision|decide)\b/i;
const QUESTION = /\?/;
const IMPERATIVE = /\b(please|let me know|take a look|review|confirm|approve|check)\b/i;

function compact(value: string, max = 700): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());

  const client = await prisma.client.findUnique({ where: { slug: 'voth' } });
  if (!client) throw new Error('VOTH not found. Run npm run clickup:sync:voth first.');

  const tasks = await prisma.task.findMany({
    where: { clientId: client.id, deleted: false },
    orderBy: { clickupUpdatedAt: 'desc' },
    include: {
      list: true,
      assignees: { include: { employee: true } },
      comments: { orderBy: { clickupCreatedAt: 'asc' } },
      intelligence: true
    }
  });

  const analyzed = tasks.map((task) => ({
    task,
    result: analyzeWithRules(buildTaskContext(task))
  }));

  console.log('VOTH INTELLIGENCE DIAGNOSTICS');
  console.log(`Tasks inspected: ${tasks.length}`);

  console.log('\n=== NON-ROUTINE CLASSIFICATIONS ===');
  const interesting = analyzed.filter(({ result }) => INTERESTING_STATES.has(result.agentState));
  console.log(`Count: ${interesting.length}`);

  for (const { task, result } of interesting) {
    console.log(`\n[${result.agentState}] ${task.name}`);
    console.log(`Task ID: ${task.clickupTaskId}`);
    console.log(`List: ${task.list.name} | ClickUp status: ${task.clickupStatus ?? '—'}`);
    console.log(`Needs Ami: ${result.needsAmi ? 'YES' : 'No'} | Waiting: ${result.waitingOnType}${result.waitingOnName ? ` (${result.waitingOnName})` : ''}`);
    console.log(`Importance: ${result.importanceScore} | Ami attention: ${result.amiAttentionScore} | Confidence: ${Math.round(result.confidence * 100)}%`);
    console.log(`Latest meaningful: ${compact(result.lastMeaningfulChange ?? '—')}`);
    console.log('Evidence:');
    for (const evidence of result.evidence.slice(-5)) {
      console.log(`  - ${evidence.kind}: ${compact(evidence.text, 450)}`);
    }
  }

  console.log('\n=== POSSIBLE MISSED NEEDS AMI ===');
  const candidates: Array<{
    taskName: string;
    taskId: string;
    listName: string;
    state: string;
    author: string;
    body: string;
    reasons: string[];
  }> = [];

  for (const { task, result } of analyzed) {
    if (result.needsAmi) continue;

    for (const comment of task.comments) {
      const body = comment.body;
      const reasons: string[] = [];
      if (AMI_MENTION.test(body)) reasons.push('mentions Ami');
      if (ACTION_LANGUAGE.test(body)) reasons.push('action/decision language');
      if (QUESTION.test(body)) reasons.push('question');
      if (IMPERATIVE.test(body)) reasons.push('imperative');

      const likelyCandidate =
        (AMI_MENTION.test(body) && (ACTION_LANGUAGE.test(body) || QUESTION.test(body))) ||
        (comment.authorName?.toLowerCase().includes('ami') === false && IMPERATIVE.test(body) && QUESTION.test(body));

      if (likelyCandidate) {
        candidates.push({
          taskName: task.name,
          taskId: task.clickupTaskId,
          listName: task.list.name,
          state: result.agentState,
          author: comment.authorName ?? 'Unknown',
          body,
          reasons
        });
      }
    }
  }

  console.log(`Candidates: ${candidates.length}`);
  for (const [index, candidate] of candidates.entries()) {
    console.log(`\n${index + 1}. ${candidate.taskName}`);
    console.log(`Task ID: ${candidate.taskId} | List: ${candidate.listName} | Current agent state: ${candidate.state}`);
    console.log(`Author: ${candidate.author}`);
    console.log(`Why flagged: ${candidate.reasons.join(', ')}`);
    console.log(`Comment: ${compact(candidate.body)}`);
  }

  console.log('\n=== AMI-MENTION AUDIT ===');
  const amiMentions = tasks.flatMap((task) =>
    task.comments
      .filter((comment) => AMI_MENTION.test(comment.body))
      .map((comment) => ({ task, comment }))
  );
  console.log(`Comments mentioning Ami: ${amiMentions.length}`);
  for (const { task, comment } of amiMentions) {
    const result = analyzed.find((entry) => entry.task.id === task.id)!.result;
    console.log(`\n${task.name} [${result.agentState}] needsAmi=${result.needsAmi}`);
    console.log(`${comment.authorName ?? 'Unknown'}: ${compact(comment.body)}`);
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
