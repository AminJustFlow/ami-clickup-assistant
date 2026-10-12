import assert from 'node:assert/strict';
import {
  aiRequestIdempotencyKey,
  assessAiReadiness,
  budgetAllows,
  expiredLeaseOutcome,
  nextUtcBudgetDay,
  releasedReservation,
  utcBudgetDay
} from '../lib/intelligence/worker-state';

const now = new Date('2026-10-12T18:00:00.000Z');
assert.equal(utcBudgetDay(now).toISOString(), '2026-10-12T00:00:00.000Z');
assert.equal(nextUtcBudgetDay(now).toISOString(), '2026-10-13T00:00:00.000Z');

// The hard cap includes actual spend plus every active reservation.
assert.equal(budgetAllows({ actual: 0.25, reserved: 1.5, request: 0.25, limit: 2 }), true);
assert.equal(budgetAllows({ actual: 0.25, reserved: 1.6, request: 0.25, limit: 2 }), false);
assert.equal(budgetAllows({ actual: 0, reserved: 0, request: 2.01, limit: 2 }), false);

// Completion, failure, and interruption release only the owning job's amount and never go negative.
assert.equal(releasedReservation(1.5, 0.25), 1.25);
assert.equal(releasedReservation(0.1, 0.25), 0);
assert.throws(() => releasedReservation(-1, 1));

// A worker interruption retries within the bound; an exhausted stale lease terminates.
assert.equal(expiredLeaseOutcome(1, 3), 'PENDING');
assert.equal(expiredLeaseOutcome(2, 3), 'PENDING');
assert.equal(expiredLeaseOutcome(3, 3), 'FAILED');

// The same job/source pair keeps the same provider idempotency key across restart.
const key = aiRequestIdempotencyKey(42, 'fingerprint-a');
assert.equal(aiRequestIdempotencyKey(42, 'fingerprint-a'), key);
assert.notEqual(aiRequestIdempotencyKey(42, 'fingerprint-b'), key);

assert.deepEqual(assessAiReadiness({ now, heartbeat: null, staleLeaseCount: 0, oldestEligibleAt: null, heartbeatMaxAgeMs: 300_000, queueMaxAgeMs: 86_400_000 }).reasons, ['ai_worker_heartbeat_missing']);
assert.deepEqual(assessAiReadiness({ now, heartbeat: { status: 'IDLE', lastSeenAt: new Date(now.getTime() - 301_000), lastSuccessAt: now }, staleLeaseCount: 0, oldestEligibleAt: null, heartbeatMaxAgeMs: 300_000, queueMaxAgeMs: 86_400_000 }).reasons, ['ai_worker_heartbeat_stale']);
assert.deepEqual(assessAiReadiness({ now, heartbeat: { status: 'PROCESSING', lastSeenAt: now, lastSuccessAt: now }, staleLeaseCount: 1, oldestEligibleAt: new Date(now.getTime() - 86_400_001), heartbeatMaxAgeMs: 300_000, queueMaxAgeMs: 86_400_000 }).reasons, ['ai_stale_leases']);
assert.deepEqual(assessAiReadiness({ now, heartbeat: { status: 'PROCESSING', lastSeenAt: now, lastSuccessAt: new Date(now.getTime() - 86_400_001) }, staleLeaseCount: 0, oldestEligibleAt: new Date(now.getTime() - 86_400_001), heartbeatMaxAgeMs: 300_000, queueMaxAgeMs: 86_400_000 }).reasons, []);
assert.deepEqual(assessAiReadiness({ now, heartbeat: { status: 'IDLE', lastSeenAt: now, lastSuccessAt: new Date(now.getTime() - 86_400_001) }, staleLeaseCount: 0, oldestEligibleAt: new Date(now.getTime() - 86_400_001), heartbeatMaxAgeMs: 300_000, queueMaxAgeMs: 86_400_000 }).reasons, ['ai_queue_stale']);
assert.equal(assessAiReadiness({ now, heartbeat: { status: 'IDLE', lastSeenAt: now, lastSuccessAt: now }, staleLeaseCount: 0, oldestEligibleAt: null, heartbeatMaxAgeMs: 300_000, queueMaxAgeMs: 86_400_000 }).ready, true);

console.log('AI worker state tests passed: interruption recovery, bounded retries, budget exhaustion, release clamping, idempotency, restart timing, and readiness.');
