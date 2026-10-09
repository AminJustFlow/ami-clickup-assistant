import { loadEnvConfig } from '@next/env';
import { prisma } from '../lib/db/prisma';
import { refreshClient } from '../lib/sync/refresh-voth';

loadEnvConfig(process.cwd());
const once = process.argv.includes('--once');
const intervalMinutes = Number(process.env.CLICKUP_SYNC_INTERVAL_MINUTES || '5');
const concurrency = Number(process.env.CLICKUP_SYNC_CONCURRENCY || '2');
if (!Number.isInteger(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 1440) throw new Error('CLICKUP_SYNC_INTERVAL_MINUTES must be 1-1440');
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 5) throw new Error('CLICKUP_SYNC_CONCURRENCY must be 1-5');

let stopping = false;
process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });

async function syncOne(client: { id: number; slug: string }) {
  const run = await prisma.syncRun.create({ data: { clientId: client.id, status: 'RUNNING' } });
  try {
    const result = await refreshClient(client.slug);
    await prisma.syncRun.update({ where: { id: run.id }, data: { status: result.failed ? 'FAILED' : 'SUCCEEDED', scanned: result.scanned, refreshed: result.refreshed, failed: result.failed, error: result.errors.slice(0, 10).join('\n') || null, completedAt: new Date() } });
    console.log('[sync] ' + client.slug + ' ' + JSON.stringify(result));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.syncRun.update({ where: { id: run.id }, data: { status: 'FAILED', failed: 1, error: message, completedAt: new Date() } });
    console.error('[sync] ' + client.slug + ': ' + message);
  }
}

async function cycle() {
  const clients = await prisma.client.findMany({ where: { active: true }, select: { id: true, slug: true }, orderBy: [{ lastSyncedAt: 'asc' }, { id: 'asc' }] });
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, clients.length) }, async () => {
    while (!stopping) { const client = clients[cursor++]; if (!client) break; await syncOne(client); }
  }));
  await prisma.workerHeartbeat.upsert({ where: { name: 'clickup-sync' }, create: { name: 'clickup-sync', status: 'IDLE', lastStartedAt: new Date(), lastSeenAt: new Date(), lastSuccessAt: new Date(), metadata: { clients: clients.length } }, update: { status: 'IDLE', lastSeenAt: new Date(), lastSuccessAt: new Date(), lastError: null, metadata: { clients: clients.length } } });
}

async function main() {
  // A process/container restart can leave audit rows marked RUNNING. They are
  // historical records only; advisory locks are released by PostgreSQL when
  // the old connection closes.
  await prisma.syncRun.updateMany({
    where: { status: 'RUNNING', completedAt: null },
    data: { status: 'INTERRUPTED', error: 'Sync process restarted before completion', completedAt: new Date() }
  });
  do { await cycle(); if (once || stopping) break; await new Promise(r => setTimeout(r, intervalMinutes * 60_000)); } while (!stopping);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
