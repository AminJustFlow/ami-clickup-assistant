-- Accelerate read-only direct-subtask lookup used by the task details drawer.
-- Prisma JSON path equality uses the rawPayload parent value; only active tasks are queried.
CREATE INDEX IF NOT EXISTS "Task_active_parent_json_idx"
ON "Task" ((("rawPayload" #> '{parent}')))
WHERE "deleted" = false;
