import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const taskId = Number(id);
  if (!Number.isSafeInteger(taskId) || taskId < 1) {
    return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 });
  }

  const task = await prisma.task.findFirst({
    where: { id: taskId, deleted: false },
    select: {
      id: true, name: true, description: true, clickupUrl: true,
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

  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

  return NextResponse.json({
    id: task.id, name: task.name, description: task.description,
    clickupUrl: task.clickupUrl, clickupStatus: task.clickupStatus,
    clickupUpdatedAt: task.clickupUpdatedAt, dueDate: task.dueDate,
    client: task.client, list: task.list, intelligence: task.intelligence,
    assignees: task.assignees.map(a => a.employee.name),
    comments: task.comments
  }, { headers: { 'Cache-Control': 'no-store' } });
}
