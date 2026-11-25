import { z } from 'zod';
export const taskFieldIds = ['status', 'due_date', 'description', 'priority', 'assignees', 'title', 'list'] as const;
const evidenceDetails = z.object({
  author: z.string().nullable(),
  occurred_at: z.string().nullable(),
  excerpt: z.string().min(1).max(500)
});
const evidenceReferenceSchema = z.union([
  evidenceDetails.extend({ source_type: z.literal('TASK_FIELD'), source_id: z.enum(taskFieldIds) }),
  evidenceDetails.extend({ source_type: z.enum(['COMMENT', 'RELATED_TASK']), source_id: z.string() })
]);
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


const decisionFields = {
  needs_ami: true, ami_action: true, next_actor: true, unresolved_request: true,
  verification_status: true, verification_reasons: true, confidence: true
} as const;

// Separate the actor for a particular request from the state of the whole task.
export const analyzerResponseSchema = taskIntelligenceSchema.omit(decisionFields).extend({
  dependency_change_comment: z.object({ comment_id: z.number().int(), excerpt: z.string().min(1).max(400) }).nullable(),
  decision_on_deliverable: taskIntelligenceSchema.pick(decisionFields).extend({
    deliverable: z.string().nullable(),
    disposition: z.enum(['PENDING', 'ANSWERED', 'RETURNED_FOR_EDITS', 'UNCERTAIN', 'NONE'])
  })
});

export function taskAssessment(response: z.infer<typeof analyzerResponseSchema>): TaskIntelligenceOutput {
  const { decision_on_deliverable, dependency_change_comment, ...task } = response;
  const { disposition, deliverable, ...decision } = decision_on_deliverable;
  if (['ANSWERED', 'RETURNED_FOR_EDITS', 'NONE'].includes(disposition)) {
    return { ...task, ...decision, needs_ami: false, ami_action: null, unresolved_request: null,
      next_actor: decision.next_actor === 'AMI' ? 'UNCLEAR' : decision.next_actor };
  }
  if (disposition === 'UNCERTAIN' || !deliverable?.trim()) decision.verification_status = 'VERIFY';
  return { ...task, ...decision };
}
