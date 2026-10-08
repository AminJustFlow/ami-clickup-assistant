import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';

type Snapshot = {
  status: string | null;
  assignees: string[];
  dueDate: string | null;
  name: string;
  description: string | null;
};

export function snapshotFromRaw(raw: Record<string, any>): Snapshot {
  return {
    status: raw.status?.status ?? null,
    assignees: (raw.assignees ?? []).map((a: any) => String(a.id)).sort(),
    dueDate: raw.due_date == null ? null : String(raw.due_date),
    name: String(raw.name ?? raw.id),
    description: raw.description || raw.text_content || null
  };
}

export function observedChanges(before: Snapshot, after: Snapshot) {
  const changes: { field: keyof Snapshot; before: unknown; after: unknown; progressEvidence: boolean }[] = [];
  for (const field of ['status', 'assignees', 'dueDate', 'name', 'description'] as const) {
    if (JSON.stringify(before[field]) === JSON.stringify(after[field])) continue;
    changes.push({
      field, before: before[field], after: after[field],
      progressEvidence: field === 'status' && before.status !== after.status
    });
  }
  return changes;
}

/** Idempotent observed snapshot transitions. No event is created for initial imports. */
export async function recordObservedTaskChanges(
  taskId: number,
  clickupTaskId: string,
  previousRaw: unknown,
  nextRaw: Record<string, any>,
  observedAt = new Date()
): Promise<number> {
  if (!previousRaw || typeof previousRaw !== 'object' || Array.isArray(previousRaw)) return 0;
  const before = snapshotFromRaw(previousRaw as Record<string, any>);
  const after = snapshotFromRaw(nextRaw);
  const changes = observedChanges(before, after);
  for (const change of changes) {
    const digest = createHash('sha256').update(JSON.stringify({
      clickupTaskId, field: change.field, before: change.before, after: change.after,
      clickupUpdatedAt: nextRaw.date_updated ?? null
    })).digest('hex');
    await prisma.taskEvent.upsert({
      where: { eventKey: 'snapshot:' + digest },
      update: {},
      create: {
        eventKey: 'snapshot:' + digest,
        taskId,
        eventType: 'OBSERVED_' + change.field.toUpperCase() + '_CHANGE',
        beforeValue: { value: change.before } as Prisma.InputJsonValue,
        afterValue: { value: change.after, progressEvidence: change.progressEvidence } as Prisma.InputJsonValue,
        occurredAt: observedAt,
        rawPayload: { source: 'sync_snapshot', clickupTaskId, observedAt: observedAt.toISOString(),
          note: 'Change observed between syncs; exact edit time and actor unknown' }
      }
    });
  }
  return changes.length;
}
