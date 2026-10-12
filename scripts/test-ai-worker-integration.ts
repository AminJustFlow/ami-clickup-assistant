import { loadEnvConfig } from '@next/env';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { PrismaClient, type Prisma } from '@prisma/client';

loadEnvConfig(process.cwd());
const target = process.env.AI_WORKER_TEST_DATABASE_URL;
if (!target) throw new Error('AI_WORKER_TEST_DATABASE_URL is required; refusing to use DATABASE_URL for a write test');
const url = new URL(target);
if (!['localhost', '127.0.0.1'].includes(url.hostname) || !url.pathname.slice(1).startsWith('ami_assistant_ai_worker_test_')) {
  throw new Error('Integration database must be localhost and named ami_assistant_ai_worker_test_*');
}

async function main() {
const databaseName = url.pathname.slice(1);
const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) throw new Error('DATABASE_URL is required only as the localhost administrative connection');
const admin = new PrismaClient({ datasourceUrl: adminUrl });
const exists = await admin.$queryRaw<Array<{ exists: boolean }>>`SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = ${databaseName}) AS exists`;
if (!exists[0]?.exists) await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
await admin.$disconnect();

process.env.DATABASE_URL = target;
process.env.OPENAI_API_KEY ||= 'integration-test-not-used';
process.env.AI_DAILY_BUDGET_USD = '2';
process.env.AI_BATCH_BUDGET_USD = '1';
process.env.AI_INPUT_USD_PER_MILLION = '1';
process.env.AI_OUTPUT_USD_PER_MILLION = '1';
process.env.AI_MAX_INPUT_TOKENS_PER_TASK = '1000';
process.env.AI_MAX_OUTPUT_TOKENS_PER_TASK = '1000';
process.env.AI_MAX_JOB_RETRIES = '3';
const migration = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { cwd: process.cwd(), env: process.env, encoding: 'utf8' });
if (migration.status !== 0) throw new Error('Migration failed:\n' + migration.stdout + '\n' + migration.stderr);

const { prisma } = await import('../lib/db/prisma');
const { completeJob, leaseJob, recoverExpiredLeases } = await import('./continuous-ai-worker');
const db = prisma as PrismaClient;

await db.analysisJob.deleteMany();
await db.task.deleteMany();
await db.clickUpList.deleteMany();
await db.client.deleteMany();
await db.space.deleteMany();
await db.workspace.deleteMany();
await db.aiBudgetDay.deleteMany();

const workspace = await db.workspace.create({ data: { clickupWorkspaceId: 'test-workspace', name: 'Test' } });
const space = await db.space.create({ data: { clickupSpaceId: 'test-space', workspaceId: workspace.id, name: 'JF Corporate' } });
const client = await db.client.create({ data: { name: 'Test Client', slug: 'test-client', clickupFolderId: 'test-folder', clickupSpaceId: space.clickupSpaceId } });
const list = await db.clickUpList.create({ data: { clickupListId: 'test-list', clientId: client.id, name: 'Test List' } });
const makeJob = async (suffix: string, data: Omit<Prisma.AnalysisJobUncheckedCreateInput, 'taskId'> = {}) => {
  const task = await db.task.create({ data: { clickupTaskId: 'test-task-' + suffix, clientId: client.id, listId: list.id, name: 'Task ' + suffix, rawPayload: {} } });
  return db.analysisJob.create({ data: { taskId: task.id, ...data } });
};

const expiredDay = new Date('2026-10-12T00:00:00.000Z');
await db.aiBudgetDay.create({ data: { day: expiredDay, reservedUsd: 0.5 } });
const retry = await makeJob('retry', { status: 'LEASED', attempts: 1, leaseOwner: 'dead', leaseExpiresAt: new Date(Date.now() - 60_000), reservationDay: expiredDay, estimatedReservedUsd: 0.25 });
const exhausted = await makeJob('exhausted', { status: 'LEASED', attempts: 3, leaseOwner: 'dead', leaseExpiresAt: new Date(Date.now() - 60_000), reservationDay: expiredDay, estimatedReservedUsd: 0.25 });
assert.equal(await db.analysisJob.count({ where: { status: 'LEASED', leaseExpiresAt: { lt: new Date() } } }), 2);
const rawExpired = await db.$queryRaw<Array<{ id: number }>>`SELECT id FROM "AnalysisJob" WHERE status = 'LEASED' AND "leaseExpiresAt" < (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') ORDER BY id LIMIT 50`;
assert.equal(rawExpired.length, 2);
assert.deepEqual(await recoverExpiredLeases(new Date(), db), { recovered: 1, failed: 1 });
assert.equal((await db.analysisJob.findUniqueOrThrow({ where: { id: retry.id } })).status, 'PENDING');
assert.equal((await db.analysisJob.findUniqueOrThrow({ where: { id: exhausted.id } })).status, 'FAILED');
assert.equal(Number((await db.aiBudgetDay.findUniqueOrThrow({ where: { day: expiredDay } })).reservedUsd), 0);

await db.analysisJob.deleteMany();
await db.task.deleteMany();
const pending = await makeJob('complete');
const leased = await leaseJob(db);
assert.ok(leased);
const leasedRow = await db.analysisJob.findUniqueOrThrow({ where: { id: leased!.id } });
assert.equal(leasedRow.status, 'LEASED');
assert.ok(leasedRow.reservationDay);
await completeJob(leased!.id, { input: 100, output: 20, actual: 0.01 }, db);
const completed = await db.analysisJob.findUniqueOrThrow({ where: { id: pending.id } });
assert.equal(completed.status, 'SUCCEEDED');
assert.equal(Number(completed.estimatedReservedUsd), 0);
const completedBudget = await db.aiBudgetDay.findUniqueOrThrow({ where: { day: leasedRow.reservationDay! } });
assert.equal(Number(completedBudget.reservedUsd), 0);
assert.equal(Number(completedBudget.actualEstimatedUsd), 0.01);

console.log('AI worker PostgreSQL integration tests passed: interrupted lease recovery, retry exhaustion, atomic reservation release, and completion accounting.');
await db.$disconnect();
}

main().catch(error => { console.error(error); process.exitCode = 1; });
