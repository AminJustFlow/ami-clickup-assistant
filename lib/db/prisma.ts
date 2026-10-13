import { PrismaClient } from '@prisma/client';

/**
 * Opt-in, metadata-only slow query diagnostics. Never log SQL, parameters,
 * client names, task text, or other ClickUp content.
 * Set SLOW_QUERY_MS to a positive threshold (for example 500) to enable.
 */
const slowQueryMs = Number(process.env.SLOW_QUERY_MS ?? 0);
const enableSlowQueryLog = process.env.NODE_ENV === 'production'
  && Number.isFinite(slowQueryMs) && slowQueryMs > 0;

function createMonitoredClient() {
  const client = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
  client.$on('query', (event) => {
    if (event.duration < slowQueryMs) return;
    const memory = process.memoryUsage();
    console.warn('[performance] ' + JSON.stringify({
      kind: 'slow-db-query',
      durationMs: event.duration,
      thresholdMs: slowQueryMs,
      rssMb: Math.round(memory.rss / 1048576),
      heapUsedMb: Math.round(memory.heapUsed / 1048576)
    }));
  });
  return client;
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = globalForPrisma.prisma ?? (enableSlowQueryLog ? createMonitoredClient() : new PrismaClient());
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
