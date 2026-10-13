import assert from 'node:assert/strict';
import { inspectQuality } from './quality-worker';

const analyzedAt = new Date('2026-10-13T12:00:00Z');
const base = {
  clickupStatus: 'in progress',
  clickupUpdatedAt: analyzedAt,
  intelligence: {
    analyzedAt, needsAmi: true, confidence: 0.95,
    amiAction: 'Confirm the launch date with the client',
    amiAttentionScore: 70, importanceScore: 65, sourceFingerprint: 'example'
  }
};
assert.deepEqual(inspectQuality(base), {
  stale: false, closedAttention: false, invalidScores: false, needsVerification: false
});
assert.equal(inspectQuality({ ...base, clickupUpdatedAt: new Date(analyzedAt.getTime() + 119_000) }).stale, false);
assert.equal(inspectQuality({ ...base, clickupUpdatedAt: new Date(analyzedAt.getTime() + 121_000) }).stale, true);
assert.equal(inspectQuality({ ...base, clickupStatus: 'completed' }).closedAttention, true);
assert.equal(inspectQuality({ ...base, intelligence: { ...base.intelligence, importanceScore: 101 } }).invalidScores, true);
assert.equal(inspectQuality({ ...base, intelligence: { ...base.intelligence, amiAction: 'N/A' } }).needsVerification, true);
assert.equal(inspectQuality({ ...base, intelligence: { ...base.intelligence, confidence: 0.4 } }).needsVerification, true);
console.log('Quality audit deterministic regression checks passed');
