import { loadEnvConfig } from '@next/env';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/db/prisma';
import { buildTaskContext } from '../lib/intelligence/context';
import { intelligenceFingerprint } from '../lib/intelligence/fingerprint';
import { findRelatedTasks } from '../lib/intelligence/related';
import { analyzeWithAI } from '../lib/intelligence/ai';
import { saveTaskIntelligence } from '../lib/intelligence/change-history';
import { TASK_ANALYZER_PROMPT_VERSION } from '../lib/intelligence/prompt';
import { groupClientFolders } from '../lib/clients/grouping';
import { aiRequestIdempotencyKey, expiredLeaseOutcome, nextUtcBudgetDay, utcBudgetDay } from '../lib/intelligence/worker-state';
import type { Prisma } from '@prisma/client';
import { pathToFileURL } from 'node:url';

if (!process.env.DATABASE_URL) loadEnvConfig(process.cwd());
const once = process.argv.includes('--once');
const workerId = randomUUID();
const model = process.env.OPENAI_INTELLIGENCE_MODEL || 'gpt-5.6-luna';
const standardDailyBudget = Number(process.env.AI_DAILY_BUDGET_USD);
// Approved one-time $2 regular-budget supplement, only for 2026-10-13 UTC.
// Reverts automatically at the next UTC day boundary without an env change.
const oneTimeBudgetDay = '2026-10-13';
const dailyBudgetFor = (now: Date = new Date()) =>
  now.toISOString().slice(0, 10) === oneTimeBudgetDay ? standardDailyBudget + 2 : standardDailyBudget;
const dailyBudget = dailyBudgetFor();
const freshBudget = Number(process.env.AI_FRESH_ACTIVITY_BUDGET_USD || '3');
const batchBudget = Number(process.env.AI_BATCH_BUDGET_USD);
const maxJobs = Number(process.env.AI_MAX_ATTEMPTS_PER_CYCLE || '10');
const maxRetries = Number(process.env.AI_MAX_JOB_RETRIES || '3');
const inputRate = Number(process.env.AI_INPUT_USD_PER_MILLION);
const outputRate = Number(process.env.AI_OUTPUT_USD_PER_MILLION);
const intervalSeconds = Number(process.env.AI_WORKER_INTERVAL_SECONDS || '60');
const maxInputTokens = Number(process.env.AI_MAX_INPUT_TOKENS_PER_TASK || '20000');
const maxOutputTokens = Number(process.env.AI_MAX_OUTPUT_TOKENS_PER_TASK || '2000');
for (const [name, value] of Object.entries({ dailyBudget, freshBudget, batchBudget, maxJobs, maxRetries, inputRate, outputRate, intervalSeconds, maxInputTokens, maxOutputTokens })) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(name + ' must be a positive number');
}
if (batchBudget > dailyBudget) throw new Error('AI_BATCH_BUDGET_USD cannot exceed AI_DAILY_BUDGET_USD');
if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required');
const reservation = Math.ceil(((maxInputTokens * inputRate + maxOutputTokens * outputRate) / 1_000_000) * 1_000_000) / 1_000_000;
if (reservation > batchBudget) throw new Error('One task reservation exceeds AI_BATCH_BUDGET_USD');

let stopping = false;
process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });
const leaseMilliseconds = Number(process.env.AI_JOB_LEASE_MINUTES || '30') * 60_000;
if (!Number.isFinite(leaseMilliseconds) || leaseMilliseconds < 5 * 60_000) throw new Error('AI_JOB_LEASE_MINUTES must be at least 5');

type LockedJob = { id: number; taskId: number; attempts: number; estimatedReservedUsd: Prisma.Decimal; reservationDay: Date | null; freshAllowance: boolean };

function isRetryableTransactionError(error: unknown): boolean {
  const value = error as { code?: string; meta?: { code?: string } };
  return value?.code === 'P2034' || (value?.code === 'P2010' && ['40001', '40P01'].includes(value.meta?.code ?? ''));
}

async function serializable<T>(client: typeof prisma, operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await client.$transaction(operation, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (!isRetryableTransactionError(error) || attempt === 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 10 * (2 ** attempt)));
    }
  }
  throw new Error('Serializable transaction failed after retries');
}

async function releaseReservation(tx: Prisma.TransactionClient, job: Pick<LockedJob, 'estimatedReservedUsd' | 'reservationDay' | 'freshAllowance'>) {
  if (!job.reservationDay || Number(job.estimatedReservedUsd) <= 0) return;
  const reservationDay = job.reservationDay.toISOString().slice(0, 10);
  await tx.$executeRaw`UPDATE "AiBudgetDay"
    SET "reservedUsd" = GREATEST(0, "reservedUsd" - ${job.estimatedReservedUsd}),
        "freshReservedUsd" = GREATEST(0, "freshReservedUsd" - CASE WHEN ${job.freshAllowance} THEN ${job.estimatedReservedUsd} ELSE 0 END),
        "updatedAt" = NOW()
    WHERE day = ${reservationDay}::date`;
}

/** Recover interrupted work before leasing anything new. Row locks make this safe with multiple workers. */
export async function recoverExpiredLeases(now = new Date(), client = prisma) {
  let recovered = 0, failed = 0;
  for (;;) {
    const changed = await serializable(client, async tx => {
      const rows = await tx.$queryRaw<LockedJob[]>`
        SELECT id, "taskId", attempts, "estimatedReservedUsd", "reservationDay", "freshAllowance"
        FROM "AnalysisJob"
        WHERE status = 'LEASED' AND "leaseExpiresAt" < (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
        ORDER BY "leaseExpiresAt", id FOR UPDATE SKIP LOCKED LIMIT 50`;
      if (!rows.length) return { count: 0, recovered: 0, failed: 0 };
      let batchRecovered = 0, batchFailed = 0;
      for (const job of rows) {
        await releaseReservation(tx, job);
        const outcome = expiredLeaseOutcome(job.attempts, maxRetries);
        await tx.analysisJob.update({ where: { id: job.id }, data: {
          status: outcome,
          leaseOwner: null,
          leaseExpiresAt: null,
          reservationDay: null,
          freshAllowance: false,
          estimatedReservedUsd: 0,
          nextAttemptAt: outcome === 'PENDING' ? now : undefined,
          completedAt: outcome === 'FAILED' ? now : null,
          lastError: outcome === 'FAILED' ? 'Worker lease expired after maximum attempts' : 'Worker lease expired; safely released for retry'
        } });
        if (outcome === 'FAILED') batchFailed++; else batchRecovered++;
      }
      return { count: rows.length, recovered: batchRecovered, failed: batchFailed };
    });
    recovered += changed.recovered; failed += changed.failed;
    if (changed.count < 50) break;
  }
  return { recovered, failed };
}

// Recover at most five historical failures per UTC day, once per task, without
// borrowing from the fresh-activity allowance or interrupting ordinary pending work.
async function recoverHistoricalFailures() {
  const day = utcBudgetDay(new Date());
  const dayText = day.toISOString().slice(0, 10);
  for (let index = 0; index < 5; index++) {
    const claimed = await serializable(prisma, async tx => {
      // Leave capacity for the normal queue and stop if lease failures recur.
      const pending = await tx.analysisJob.count({ where: { status: 'PENDING' } });
      if (pending > 0) return false;
      const recentFailures = await tx.analysisJob.count({ where: {
        status: 'FAILED', updatedAt: { gte: new Date(Date.now() - 60 * 60_000) }
      } });
      if (recentFailures > 0) return false;
      const already = await tx.analysisJob.count({ where: { recoveryDay: day } });
      if (already >= 5) return false;
      await tx.aiBudgetDay.upsert({ where: { day }, create: { day }, update: {} });
      const budget = await tx.aiBudgetDay.findUniqueOrThrow({ where: { day } });
      const regularSpent = Number(budget.actualEstimatedUsd) - Number(budget.freshActualUsd)
        + Number(budget.reservedUsd) - Number(budget.freshReservedUsd);
      if (regularSpent + reservation > dailyBudget + 1e-9) return false;
      const rows = await tx.$queryRaw<Array<{ id: number }>>`
        SELECT j.id FROM "AnalysisJob" j
        JOIN "Task" t ON t.id = j."taskId"
        LEFT JOIN "TaskIntelligence" i ON i."taskId" = t.id
        WHERE j.status = 'FAILED' AND j.attempts >= ${maxRetries}
          AND j."recoveryCount" = 0 AND j."recoveryDay" IS NULL
          AND j."lastError" IN ('Worker lease expired after maximum attempts',
            'Recovered legacy expired lease after maximum attempts')
          AND t.deleted = false AND t."createdAt" < NOW() - INTERVAL '24 hours'
          AND i.id IS NULL
        ORDER BY t."clickupUpdatedAt" DESC NULLS LAST, j.id
        FOR UPDATE OF j SKIP LOCKED LIMIT 1`;
      if (!rows.length) return false;
      const updated = await tx.analysisJob.updateMany({
        where: { id: rows[0].id, status: 'FAILED', recoveryCount: 0 },
        data: { status: 'PENDING', attempts: 0, nextAttemptAt: new Date(),
          recoveryDay: day, recoveryCount: 1, completedAt: null,
          lastError: 'One-time historical recovery queued' }
      });
      return updated.count === 1;
    });
    if (!claimed) break;
  }
}

async function refreshQueue() {
  const teamNames = (await prisma.employee.findMany({ select: { name: true } })).map(x => x.name);
  // Bounded discovery keeps the worker viable on a 2 GB host. The definitive
  // fingerprint is calculated with full client-group context after leasing.
  const expectedVersion = TASK_ANALYZER_PROMPT_VERSION + ':' + model;
  const candidates = await prisma.$queryRaw<Array<{ id: number }>>`
    SELECT t.id FROM "Task" t LEFT JOIN "TaskIntelligence" i ON i."taskId" = t.id
    WHERE t.deleted = false AND (i.id IS NULL OR i."analyzedAt" IS NULL OR i."promptVersion" IS DISTINCT FROM ${expectedVersion}
      OR t."clickupUpdatedAt" > i."analyzedAt")
    ORDER BY COALESCE(i."needsAmi", false) DESC, COALESCE(i."amiAttentionScore", 0) DESC, t."clickupUpdatedAt" DESC NULLS LAST
    LIMIT 500`;
  for (const task of candidates) {
    const existing = await prisma.analysisJob.findUnique({ where: { taskId: task.id }, select: { status: true } });
    if (!existing) await prisma.analysisJob.create({ data: { taskId: task.id } });
    else if (existing.status === 'SUCCEEDED') await prisma.analysisJob.update({ where: { taskId: task.id }, data: { status: 'PENDING', attempts: 0, nextAttemptAt: new Date(), lastError: null, completedAt: null } });
  }
  // Revisit legacy paused jobs that now qualify for the dedicated fresh allowance.
  // Mark failed budget checks so a full fresh allowance does not cause a retry loop.
  await prisma.$executeRaw`
    UPDATE "AnalysisJob" j
    SET status = 'PENDING', "nextAttemptAt" = NOW()
    FROM "Task" t LEFT JOIN "TaskIntelligence" i ON i."taskId" = t.id
    WHERE j."taskId" = t.id AND j.status = 'PAUSED_BUDGET'
      AND j."nextAttemptAt" > NOW() AND j."lastError" IS DISTINCT FROM 'fresh_allowance_checked'
      AND t.deleted = false AND (
        (i.id IS NULL AND t."createdAt" >= NOW() - INTERVAL '24 hours')
        OR (i."analyzedAt" IS NOT NULL AND EXISTS (
          SELECT 1 FROM "TaskEvent" e WHERE e."taskId" = t.id
          AND e."occurredAt" > i."analyzedAt"
          AND e."occurredAt" >= NOW() - INTERVAL '24 hours'
          AND e."eventType" IN ('OBSERVED_STATUS_CHANGE', 'OBSERVED_DESCRIPTION_CHANGE', 'OBSERVED_DUEDATE_CHANGE')
        ))
      )`;
  return teamNames;
}

export async function leaseJob(client = prisma) {
  // Skip a budget-blocked job and keep searching for one eligible under the other allowance.
  for (let scan = 0; scan < 500; scan++) {
  const outcome = await serializable(client, async tx => {
    const now = new Date();
    const budgetDay = utcBudgetDay(now);
    const budgetDayText = budgetDay.toISOString().slice(0, 10);
    const rows = await tx.$queryRaw<Array<{ id: number; taskId: number; freshEligible: boolean }>>`
      SELECT j.id, j."taskId",
        ((
          (i.id IS NULL AND t."createdAt" >= NOW() - INTERVAL '24 hours')
          OR (i."analyzedAt" IS NOT NULL AND EXISTS (
            SELECT 1 FROM "TaskEvent" e
            WHERE e."taskId" = t.id AND e."occurredAt" > i."analyzedAt"
              AND e."occurredAt" >= NOW() - INTERVAL '24 hours'
              AND e."eventType" IN ('OBSERVED_STATUS_CHANGE', 'OBSERVED_DESCRIPTION_CHANGE', 'OBSERVED_DUEDATE_CHANGE')
          ))
        ) AND j."recoveryCount" = 0) AS "freshEligible"
      FROM "AnalysisJob" j
      JOIN "Task" t ON t.id = j."taskId"
      LEFT JOIN "TaskIntelligence" i ON i."taskId" = t.id
      WHERE j.status = 'PENDING' AND j."nextAttemptAt" <= NOW() AND j.attempts < ${maxRetries}
        AND t.deleted = false
      ORDER BY "freshEligible" DESC, j."nextAttemptAt", j.id
      FOR UPDATE OF j SKIP LOCKED LIMIT 1`;
    const job = rows[0]; if (!job) return null;
    await tx.aiBudgetDay.upsert({ where: { day: budgetDay }, create: { day: budgetDay }, update: {} });
    const fresh = job.freshEligible;
    const reserved = await tx.$executeRaw`UPDATE "AiBudgetDay"
      SET "reservedUsd" = "reservedUsd" + ${reservation},
          "freshReservedUsd" = "freshReservedUsd" + CASE WHEN ${fresh} THEN ${reservation} ELSE 0 END,
          "updatedAt" = NOW()
      WHERE day = ${budgetDayText}::date
        AND (
          (${fresh} AND "freshActualUsd" + "freshReservedUsd" + ${reservation} <= ${freshBudget}
            AND "actualEstimatedUsd" + "reservedUsd" + ${reservation} <= ${dailyBudget + freshBudget})
          OR
          (NOT ${fresh} AND "actualEstimatedUsd" - "freshActualUsd"
            + "reservedUsd" - "freshReservedUsd" + ${reservation} <= ${dailyBudget}
            AND "actualEstimatedUsd" + "reservedUsd" + ${reservation} <= ${dailyBudget + freshBudget})
        )`;
    if (!reserved) {
      await tx.analysisJob.update({ where: { id: job.id }, data: { status: 'PAUSED_BUDGET', nextAttemptAt: nextUtcBudgetDay(now), lastError: fresh ? 'fresh_allowance_checked' : 'regular_allowance_checked' } }); return { skipped: true as const };
    }
    await tx.analysisJob.update({ where: { id: job.id }, data: { status: 'LEASED', leaseOwner: workerId, leaseExpiresAt: new Date(now.getTime() + leaseMilliseconds), attempts: { increment: 1 }, estimatedReservedUsd: reservation, reservationDay: budgetDay, freshAllowance: fresh } });
    return { skipped: false as const, job };
  });
  if (!outcome) return null;
  if (!outcome.skipped) return outcome.job;
  }
  return null;
}

export async function renewOwnedLease(jobId: number, now = new Date(), client = prisma): Promise<boolean> {
  const [updated] = await client.$transaction([
    client.analysisJob.updateMany({ where: { id: jobId, status: 'LEASED', leaseOwner: workerId }, data: { leaseExpiresAt: new Date(now.getTime() + leaseMilliseconds) } }),
    client.workerHeartbeat.updateMany({ where: { name: 'ai-worker' }, data: { status: 'PROCESSING', lastSeenAt: now } })
  ]);
  return updated.count === 1;
}

async function withLeaseRenewal<T>(jobId: number, operation: () => Promise<T>): Promise<T> {
  const intervalMs = Math.max(30_000, Math.min(60_000, Math.floor(leaseMilliseconds / 3)));
  let renewalInFlight: Promise<void> | null = null;
  let renewalError: Error | null = null;
  const renew = () => {
    if (renewalInFlight || renewalError) return;
    renewalInFlight = renewOwnedLease(jobId).then(owned => {
      if (!owned) renewalError = new Error('Worker lost job lease during AI request');
    }).catch(error => { renewalError = error instanceof Error ? error : new Error(String(error)); }).finally(() => { renewalInFlight = null; });
  };
  const timer = setInterval(renew, intervalMs);
  try {
    const result = await operation();
    if (renewalInFlight) await renewalInFlight;
    if (renewalError) throw renewalError;
    return result;
  } finally {
    clearInterval(timer);
  }
}

async function processJob(job: { id: number; taskId: number }, teamNames: string[]) {
  const task = await prisma.task.findUniqueOrThrow({ where: { id: job.taskId }, include: { list: true, intelligence: true, assignees: { include: { employee: true } }, comments: { orderBy: { clickupCreatedAt: 'asc' } } } });
  const clientRows = await prisma.client.findMany({ where: { active: true }, select: { id: true, slug: true, name: true, clickupFolderId: true } });
  const group = groupClientFolders(clientRows).find(item => item.folders.some(folder => folder.id === task.clientId));
  const scopeIds = group?.folders.map(folder => folder.id) ?? [task.clientId];
  const scopeTasks = await prisma.task.findMany({
    where: { clientId: { in: scopeIds }, deleted: false },
    include: {
      list: true,
      intelligence: true,
      assignees: { include: { employee: true } },
      comments: { orderBy: { clickupCreatedAt: 'asc' } }
    }
  });
  const context = buildTaskContext(task); const related = findRelatedTasks(context, scopeTasks.map(buildTaskContext));
  const fingerprint = intelligenceFingerprint(context, model, teamNames, related);
  try {
    // If a prior worker saved the exact result and died before finalizing the job,
    // finalize without paying for duplicate analysis.
    if (task.intelligence?.sourceFingerprint === fingerprint && task.intelligence.promptVersion === TASK_ANALYZER_PROMPT_VERSION + ':' + model) {
      // The provider may have completed before the previous worker crashed.
      // With no persisted token counts, convert the full reservation to actual
      // spend so the hard cap remains conservative rather than recording $0.
      await completeJob(job.id, { input: 0, output: 0, actual: null });
      return;
    }
    await prisma.analysisJob.updateMany({ where: { id: job.id, status: 'LEASED', leaseOwner: workerId }, data: { sourceFingerprint: fingerprint } });
    const result = await withLeaseRenewal(job.id, () => analyzeWithAI(context, { model, teamNames, related, idempotencyKey: aiRequestIdempotencyKey(job.id, fingerprint) }));
    if (result.source !== 'AI') throw new Error('OpenAI analysis did not complete');
    const stillOwned = await prisma.analysisJob.count({ where: { id: job.id, status: 'LEASED', leaseOwner: workerId, leaseExpiresAt: { gt: new Date() } } });
    if (!stillOwned) throw new Error('Worker lost job lease before result could be committed');
    await saveTaskIntelligence(task.id, { agentState: result.agentState, headline: result.headline, currentSummary: result.currentSummary, needsAmi: result.needsAmi, amiAction: result.amiAction, waitingOnType: result.waitingOnType, waitingOnName: result.waitingOnName, importanceScore: result.importanceScore, amiAttentionScore: result.amiAttentionScore, riskLevel: result.riskLevel, lastMeaningfulChange: result.lastMeaningfulChange, lastMeaningfulChangeAt: result.lastMeaningfulChangeAt, confidence: result.confidence, promptVersion: TASK_ANALYZER_PROMPT_VERSION + ':' + model, analyzedAt: new Date(), sourceFingerprint: fingerprint });
    const input = result.usage?.inputTokens ?? 0, output = result.usage?.outputTokens ?? 0;
    const actual = (input * inputRate + output * outputRate) / 1_000_000;
    await completeJob(job.id, { input, output, actual });
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
    const current = await prisma.analysisJob.findUniqueOrThrow({ where: { id: job.id } });
    const terminal = current.attempts >= maxRetries;
    await serializable(prisma, async tx => {
      const locked = (await tx.$queryRaw<LockedJob[]>`SELECT id, "taskId", attempts, "estimatedReservedUsd", "reservationDay", "freshAllowance" FROM "AnalysisJob" WHERE id = ${job.id} AND status = 'LEASED' AND "leaseOwner" = ${workerId} FOR UPDATE`)[0];
      if (!locked) return;
      await releaseReservation(tx, locked);
      if (locked.reservationDay) await tx.aiBudgetDay.update({ where: { day: locked.reservationDay }, data: { failedJobs: { increment: 1 } } });
      await tx.analysisJob.update({ where: { id: job.id }, data: { status: terminal ? 'FAILED' : 'PENDING', leaseOwner: null, leaseExpiresAt: null, reservationDay: null, freshAllowance: false, estimatedReservedUsd: 0, lastError: message, completedAt: terminal ? new Date() : null, nextAttemptAt: new Date(Date.now() + Math.min(3600, 30 * (2 ** current.attempts)) * 1000) } });
    });
  }
}

export async function completeJob(jobId: number, usage: { input: number; output: number; actual: number | null }, client = prisma) {
  await serializable(client, async tx => {
    const locked = (await tx.$queryRaw<LockedJob[]>`SELECT id, "taskId", attempts, "estimatedReservedUsd", "reservationDay", "freshAllowance" FROM "AnalysisJob" WHERE id = ${jobId} AND status = 'LEASED' AND "leaseOwner" = ${workerId} FOR UPDATE`)[0];
    if (!locked) return;
    await releaseReservation(tx, locked);
    if (!locked.reservationDay) throw new Error('Leased job has no reservation day');
    const actual = usage.actual ?? Number(locked.estimatedReservedUsd);
    await tx.aiBudgetDay.update({ where: { day: locked.reservationDay }, data: { actualEstimatedUsd: { increment: actual }, ...(locked.freshAllowance ? { freshActualUsd: { increment: actual } } : {}), inputTokens: { increment: usage.input }, outputTokens: { increment: usage.output }, successfulJobs: { increment: 1 } } });
    await tx.analysisJob.update({ where: { id: jobId }, data: { status: 'SUCCEEDED', leaseOwner: null, leaseExpiresAt: null, reservationDay: null, freshAllowance: false, estimatedReservedUsd: 0, actualInputTokens: usage.actual === null ? null : usage.input, actualOutputTokens: usage.actual === null ? null : usage.output, actualEstimatedUsd: actual, completedAt: new Date(), lastError: null } });
  });
}

async function cycle() {
  await prisma.analysisJob.updateMany({ where: { status: 'PAUSED_BUDGET', nextAttemptAt: { lte: new Date() } }, data: { status: 'PENDING' } });
  // Release only regular-budget pauses for the approved one-time day.
  // The reservation transaction still enforces the full daily cap.
  if (new Date().toISOString().slice(0, 10) === oneTimeBudgetDay) {
    await prisma.analysisJob.updateMany({
      where: { status: 'PAUSED_BUDGET', lastError: 'regular_allowance_checked' },
      data: { status: 'PENDING', nextAttemptAt: new Date() }
    });
  }
  const recovery = await recoverExpiredLeases();
  await prisma.workerHeartbeat.upsert({ where: { name: 'ai-worker' }, create: { name: 'ai-worker', status: 'PROCESSING', lastStartedAt: new Date(), lastSeenAt: new Date(), metadata: { recovery } }, update: { status: 'PROCESSING', lastStartedAt: new Date(), lastSeenAt: new Date(), lastError: null, metadata: { recovery } } });
  const teamNames = await refreshQueue(); await recoverHistoricalFailures(); let attempts = 0; let batchReserved = 0;
  while (!stopping && attempts < maxJobs && batchReserved + reservation <= batchBudget + 1e-9) { const job = await leaseJob(); if (!job) break; attempts++; batchReserved += reservation; await processJob(job, teamNames); await prisma.workerHeartbeat.update({ where: { name: 'ai-worker' }, data: { lastSeenAt: new Date() } }); }
  const counts = await prisma.analysisJob.groupBy({ by: ['status'], _count: true });
  await prisma.workerHeartbeat.upsert({ where: { name: 'ai-worker' }, create: { name: 'ai-worker', status: 'IDLE', lastStartedAt: new Date(), lastSeenAt: new Date(), lastSuccessAt: new Date(), metadata: { counts } }, update: { status: 'IDLE', lastSeenAt: new Date(), lastSuccessAt: new Date(), lastError: null, metadata: { counts } } });
}
async function main() { do { await cycle(); if (once || stopping) break; await new Promise(r => setTimeout(r, intervalSeconds * 1000)); } while (!stopping); }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(async error => { console.error(error); await prisma.workerHeartbeat.upsert({ where: { name: 'ai-worker' }, create: { name: 'ai-worker', status: 'FAILED', lastSeenAt: new Date(), lastError: String(error) }, update: { status: 'FAILED', lastSeenAt: new Date(), lastError: String(error) } }); process.exitCode = 1; }).finally(() => prisma.$disconnect());
}
