import { z } from 'zod';
export const taskIntelligenceSchema = z.object({
  meaningful_change: z.boolean(),
  agent_state: z.enum(['NOT_STARTED','ACTIVE','COMPLETED','WAITING_ON_AMI','WAITING_ON_TEAM','WAITING_ON_CLIENT','WAITING_ON_VENDOR','NEEDS_REVIEW','BLOCKED','ISSUE','UNKNOWN']),
  headline: z.string(),
  current_summary: z.string(),
  needs_ami: z.boolean(),
  ami_action: z.string().nullable(),
  waiting_on_type: z.enum(['NONE','AMI','TEAM','CLIENT','VENDOR','OTHER']),
  waiting_on_name: z.string().nullable(),
  risk: z.enum(['LOW','MEDIUM','HIGH','CRITICAL']),
  importance: z.number().int().min(0).max(100),
  confidence: z.number().min(0).max(1),
  last_meaningful_change: z.string()
});
export type TaskIntelligenceOutput = z.infer<typeof taskIntelligenceSchema>;
