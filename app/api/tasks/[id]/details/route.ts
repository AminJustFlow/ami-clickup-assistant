import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { buildTaskHierarchy, clickupParentId } from '@/lib/tasks/hierarchy';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const taskId = Number(id);
  if (!Number.isSafeInteger(taskId) || taskId < 1) {
    return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 });
  }

  const startedAt = performance.now();
  const task = await prisma.task.findFirst({
    where: { id: taskId, deleted: false },
    select: {
      id: true, clickupTaskId: true, rawPayload: true, name: true, description: true, clickupUrl: true,
      clickupStatus: true, clickupUpdatedAt: true, dueDate: true,
      client: { select: { name: true, slug: true } },
      list: { select: { name: true } },
      intelligence: { select: {
        agentState: true, needsAmi: true, amiAction: true, currentSummary: true,
        waitingOnName: true, waitingOnType: true, lastMeaningfulChange: true,
        lastMeaningfulChangeAt: true, confidence: true, analyzedAt: true
      } },
      assignees: { select: { employee: { select: { name: true } } } },
      comments: {
        orderBy: [{ clickupCreatedAt: 'desc' }, { id: 'desc' }],
        take: 10,
        select: { id: true, authorName: true, body: true, clickupCreatedAt: true }
      }
    }
  });

  const taskQueryMs = performance.now() - startedAt;
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

  const parentClickupId = clickupParentId(task.rawPayload);
  // Only retrieve the relevant hierarchy, not all workspace tasks.
  // The descendant query uses the ClickUp raw parent field already stored in PostgreSQL.
  const hierarchyStartedAt = performance.now();
  const related = await prisma.task.findMany({
    where: {
      deleted: false,
      OR: [
        { clickupTaskId: parentClickupId ?? task.clickupTaskId },
        { rawPayload: { path: ['parent'], equals: task.clickupTaskId } }
      ]
    },
    select: {
      id: true, clickupTaskId: true, rawPayload: true, name: true,
      clickupStatus: true, deleted: true, dueDate: true, clickupUrl: true,
      assignees: { select: { employee: { select: { name: true } } } }
    }
  });
  const hierarchyQueryMs = performance.now() - hierarchyStartedAt;
  const parent = parentClickupId ? related.find(item => item.clickupTaskId === parentClickupId) : null;
  const children = related.filter(item => clickupParentId(item.rawPayload) === task.clickupTaskId);
  const relatedSummary = (item: typeof related[number]) => ({
    id: item.id, name: item.name, clickupStatus: item.clickupStatus,
    dueDate: item.dueDate, clickupUrl: item.clickupUrl,
    assignees: item.assignees.map(a => a.employee.name)
  });
  // Build the direct-child rollup using the same hierarchy rules as Phase 33.3.1.
  const hierarchy = buildTaskHierarchy([
    { id: task.id, clickupTaskId: task.clickupTaskId, rawPayload: task.rawPayload,
      name: task.name, clickupStatus: task.clickupStatus, deleted: false },
    ...children.map(item => ({
      id: item.id, clickupTaskId: item.clickupTaskId, rawPayload: item.rawPayload,
      name: item.name, clickupStatus: item.clickupStatus, deleted: false
    }))
  ]);
  const completedDirectChildren = hierarchy.byId.get(task.id)?.completedDescendants ?? 0;

  const totalMs = performance.now() - startedAt;
  return NextResponse.json({
    hierarchy: {
      parent: parent ? relatedSummary(parent) : null,
      parentUnavailable: Boolean(parentClickupId && !parent),
      children: children.map(relatedSummary),
      directChildren: children.length,
      completedDirectChildren
    },
    id: task.id, name: task.name, description: task.description,
    clickupUrl: task.clickupUrl, clickupStatus: task.clickupStatus,
    clickupUpdatedAt: task.clickupUpdatedAt, dueDate: task.dueDate,
    client: task.client, list: task.list, intelligence: task.intelligence,
    assignees: task.assignees.map(a => a.employee.name),
    comments: task.comments
  }, { headers: {
    'Cache-Control': 'no-store',
    'Server-Timing': `task;dur=${taskQueryMs.toFixed(1)}, hierarchy;dur=${hierarchyQueryMs.toFixed(1)}, total;dur=${totalMs.toFixed(1)}`
  } });
}
