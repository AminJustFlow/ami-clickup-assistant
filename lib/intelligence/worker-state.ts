import { createHash } from 'node:crypto';

export const AI_WORKER_NAME = 'ai-worker';

export function utcBudgetDay(now = new Date()): Date {
  return new Date(now.toISOString().slice(0, 10) + 'T00:00:00.000Z');
}

export function nextUtcBudgetDay(now = new Date()): Date {
  return new Date(utcBudgetDay(now).getTime() + 86_400_000);
}

export function budgetAllows(input: { actual: number; reserved: number; request: number; limit: number }): boolean {
  const values = Object.values(input);
  if (!values.every(Number.isFinite) || input.actual < 0 || input.reserved < 0 || input.request < 0 || input.limit < 0) return false;
  return input.actual + input.reserved + input.request <= input.limit + 1e-9;
}

export function releasedReservation(current: number, release: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(release) || current < 0 || release < 0) throw new Error('Reservation amounts must be finite and non-negative');
  return Math.max(0, current - release);
}

export function expiredLeaseOutcome(attempts: number, maxRetries: number): 'PENDING' | 'FAILED' {
  if (!Number.isInteger(attempts) || !Number.isInteger(maxRetries) || attempts < 0 || maxRetries < 1) throw new Error('Invalid retry state');
  return attempts >= maxRetries ? 'FAILED' : 'PENDING';
}

export function aiRequestIdempotencyKey(jobId: number, sourceFingerprint: string): string {
  return 'ami-ai-' + jobId + '-' + createHash('sha256').update(sourceFingerprint).digest('hex').slice(0, 32);
}

export type AiReadinessInput = {
  now: Date;
  heartbeat: { status: string; lastSeenAt: Date; lastSuccessAt: Date | null } | null;
  staleLeaseCount: number;
  oldestEligibleAt: Date | null;
  heartbeatMaxAgeMs: number;
  queueMaxAgeMs: number;
};

export function assessAiReadiness(input: AiReadinessInput): { ready: boolean; reasons: string[] } {
  const reasons: string[] = [];
  let heartbeatStale = false;
  if (!input.heartbeat) reasons.push('ai_worker_heartbeat_missing');
  else {
    if (input.heartbeat.status === 'FAILED') reasons.push('ai_worker_failed');
    heartbeatStale = input.now.getTime() - input.heartbeat.lastSeenAt.getTime() > input.heartbeatMaxAgeMs;
    if (heartbeatStale) reasons.push('ai_worker_heartbeat_stale');
  }
  if (input.staleLeaseCount > 0) reasons.push('ai_stale_leases');
  const noRecentSuccessfulCycle = !input.heartbeat?.lastSuccessAt || input.now.getTime() - input.heartbeat.lastSuccessAt.getTime() > input.queueMaxAgeMs;
  if (input.oldestEligibleAt && input.now.getTime() - input.oldestEligibleAt.getTime() > input.queueMaxAgeMs && (heartbeatStale || noRecentSuccessfulCycle)) reasons.push('ai_queue_stale');
  return { ready: reasons.length === 0, reasons };
}
