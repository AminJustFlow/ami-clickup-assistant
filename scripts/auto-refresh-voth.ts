import { loadEnvConfig } from '@next/env';
import { prisma } from '../lib/db/prisma';
import { refreshVoth } from '../lib/sync/refresh-voth';

loadEnvConfig(process.cwd());
const once = process.argv.includes('--once');
const intervalMinutes = Number(process.env.CLICKUP_SYNC_INTERVAL_MINUTES || '5');
if (!Number.isFinite(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 1440) {
  throw new Error('CLICKUP_SYNC_INTERVAL_MINUTES must be between 1 and 1440');
}

let stopping = false;
let inFlight = false;
process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });

async function run() {
  if (inFlight) return;
  inFlight = true;
  try {
    const start = new Date();
    console.log('[refresh] Starting ' + start.toISOString());
    const result = await refreshVoth();
    console.log('[refresh] ' + JSON.stringify(result));
    if (result.failed > 0) process.exitCode = 1;
  } catch (error) {
    console.error('[refresh] Failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    inFlight = false;
  }
}

async function main() {
  if (!once) console.log('[refresh] Watching ClickUp every ' + intervalMinutes + ' minute(s). Keep this process running.');
  do {
    await run();
    if (once || stopping) break;
    await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, intervalMinutes * 60_000);
      timer.unref?.();
    });
  } while (!stopping);
}

main().finally(() => prisma.$disconnect());
