import { z } from 'zod';
const evidenceReferenceSchema = z.object({
  source_type: z.enum(['COMMENT', 'TASK_FIELD', 'RELATED_TASK']),
  source_id: z.string(),
  author: z.string().nullable(),
  occurred_at: z.string().nullable(),
  excerpt: z.string().min(1).max(500)
});
export const taskIntelligenceSchema = z.object({
  meaningful_change: z.boolean(),
  agent_state: z.enum(['NOT_STARTED','ACTIVE','COMPLETED','WAITING_ON_AMI','WAITING_ON_TEAM','WAITING_ON_CLIENT','WAITING_ON_VENDOR','NEEDS_REVIEW','BLOCKED','ISSUE','UNKNOWN']),
  headline: z.string(),
  current_summary: z.string(),
  needs_ami: z.boolean(),
  ami_action: z.string().nullable(),
  next_actor: z.enum(['AMI', 'TEAM', 'CLIENT', 'VENDOR', 'NONE', 'UNCLEAR']),
  unresolved_request: z.string().nullable(),
  evidence_references: z.array(evidenceReferenceSchema).max(5),
  contradicting_evidence: z.array(evidenceReferenceSchema).max(5),
  freshness_status: z.enum(['CURRENT', 'UNCERTAIN', 'STALE']),
  verification_status: z.enum(['VERIFIED', 'VERIFY']),
  verification_reasons: z.array(z.string().max(180)).max(5),
  waiting_on_type: z.enum(['NONE','AMI','TEAM','CLIENT','VENDOR','OTHER']),
  waiting_on_name: z.string().nullable(),
  risk: z.enum(['LOW','MEDIUM','HIGH','CRITICAL']),
  importance: z.number().int().min(0).max(100),
  priority_level: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  priority_score: z.number().int().min(0).max(100),
  priority_reasons: z.array(z.string().max(180)).max(5),
  confidence: z.number().min(0).max(1),
  last_meaningful_change: z.string()
});
export type TaskIntelligenceOutput = z.infer<typeof taskIntelligenceSchema>;
