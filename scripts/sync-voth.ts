import { loadEnvConfig } from '@next/env';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/db/prisma';
import { ClickUpApiError, getFolderLists, getTaskComments, getCommentReplies, getTasks } from '../lib/clickup/client';
import { resolveClientFolder } from '../lib/clickup/discovery';
import { clickupDate, commentPlainText, isClosedTask } from '../lib/clickup/raw';

const VOTH_FOLDER_NAME = 'The Village on Technology Hill (VTH)';
const VOTH_SLUG = 'voth';
interface SyncStats { lists: number; tasks: number; openTasks: number; closedTasks: number; successfulTasks: number; failedTasks: number; comments: number; successfulCommentImports: number; failedCommentImports: number }

function apiFailure(error: unknown): string {
  if (error instanceof ClickUpApiError) return `HTTP ${error.status}: ${error.message}`;
  return error instanceof Error ? error.message : 'Unknown error';
}

async function getAllTasks(listId: string): Promise<Record<string, any>[]> {
  const all: Record<string, any>[] = [];
  for (let page = 0; ; page += 1) {
    const { tasks } = await getTasks(listId, page);
    all.push(...tasks);
    if (tasks.length < 100) return all;
  }
}

async function getAllComments(taskId: string): Promise<Record<string, any>[]> {
  const all: Record<string, any>[] = [];
  let cursor: { start: string; startId: string } | undefined;
  const seenCursors = new Set<string>();
  for (;;) {
    const { comments = [] } = await getTaskComments(taskId, cursor);
    all.push(...comments);
    if (comments.length < 25) return all;
    const last = comments.at(-1);
    if (!last?.id || !last?.date) return all;
    const key = `${last.date}:${last.id}`;
    if (seenCursors.has(key)) throw new Error('ClickUp returned a repeated comment pagination cursor');
    seenCursors.add(key);
    cursor = { start: String(last.date), startId: String(last.id) };
  }
}

async function syncComments(task: { id: number; clickupTaskId: string; name: string }, stats: SyncStats): Promise<void> {
  try {
    const comments = await getAllComments(task.clickupTaskId);
    for (const parent of comments) {
      const replies = await getCommentReplies(String(parent.id));
      const thread = [parent, ...(replies.comments ?? [])];
      for (const raw of thread) {
      const user = raw.user && typeof raw.user === 'object' ? raw.user as Record<string, unknown> : {};
      const data = {
        taskId: task.id,
        authorClickupId: user.id === null || user.id === undefined ? null : String(user.id),
        authorName: typeof user.username === 'string' ? user.username : null,
        body: commentPlainText(raw),
        clickupCreatedAt: clickupDate(raw.date),
        clickupUpdatedAt: clickupDate(raw.date_updated),
        rawPayload: raw as Prisma.InputJsonValue
      };
      await prisma.comment.upsert({
        where: { clickupCommentId: String(raw.id) },
        update: data,
        create: { clickupCommentId: String(raw.id), ...data }
      });
      stats.comments += 1;
      }
    }
    stats.successfulCommentImports += 1;
  } catch (error) {
    stats.failedCommentImports += 1;
    console.error(`COMMENT FAILURE | Task ${task.clickupTaskId} | ${task.name} | ${apiFailure(error)}`);
  }
}

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const mapping = await resolveClientFolder({ exactName: VOTH_FOLDER_NAME });
  console.log(`VOTH Folder: ${mapping.folder.name} (${mapping.folder.id})`);
  console.log(`Space: ${mapping.space.name} (${mapping.space.id})`);

  const workspace = await prisma.workspace.upsert({ where: { clickupWorkspaceId: mapping.workspace.id }, update: { name: mapping.workspace.name }, create: { clickupWorkspaceId: mapping.workspace.id, name: mapping.workspace.name } });
  await prisma.space.upsert({ where: { clickupSpaceId: mapping.space.id }, update: { name: mapping.space.name, workspaceId: workspace.id }, create: { clickupSpaceId: mapping.space.id, name: mapping.space.name, workspaceId: workspace.id } });
  const client = await prisma.client.upsert({
    where: { clickupFolderId: mapping.folder.id },
    update: { name: mapping.folder.name, slug: VOTH_SLUG, clickupSpaceId: mapping.space.id, active: true },
    create: { name: mapping.folder.name, slug: VOTH_SLUG, clickupFolderId: mapping.folder.id, clickupSpaceId: mapping.space.id }
  });

  const { lists: liveLists } = await getFolderLists(mapping.folder.id);
  const discoveredIds = new Set(mapping.folder.lists.map((list) => list.id));
  for (const list of liveLists) if (!discoveredIds.has(String(list.id))) console.warn(`New List not present in saved discovery: ${list.name} (${list.id})`);
  await prisma.clickUpList.updateMany({ where: { clientId: client.id }, data: { active: false } });
  const stats: SyncStats = { lists: liveLists.length, tasks: 0, openTasks: 0, closedTasks: 0, successfulTasks: 0, failedTasks: 0, comments: 0, successfulCommentImports: 0, failedCommentImports: 0 };

  for (const [index, rawList] of liveLists.entries()) {
    const list = await prisma.clickUpList.upsert({ where: { clickupListId: String(rawList.id) }, update: { clientId: client.id, name: rawList.name, active: true }, create: { clickupListId: String(rawList.id), clientId: client.id, name: rawList.name, active: true } });
    console.log(`[List ${index + 1}/${liveLists.length}] ${list.name} (${list.clickupListId})`);
    let rawTasks: Record<string, any>[];
    try {
      rawTasks = await getAllTasks(list.clickupListId);
      await prisma.task.updateMany({ where: { listId: list.id }, data: { deleted: true } });
    } catch (error) {
      console.error(`LIST FAILURE | ${list.clickupListId} | ${list.name} | ${apiFailure(error)}`);
      continue;
    }
    console.log(`  ${rawTasks.length} tasks (including closed/completed)`);
    stats.tasks += rawTasks.length;

    for (const [taskIndex, raw] of rawTasks.entries()) {
      try {
        if (isClosedTask(raw)) stats.closedTasks += 1; else stats.openTasks += 1;
        const taskData = {
          clientId: client.id, listId: list.id, name: String(raw.name ?? raw.id),
          description: raw.description || raw.text_content || null,
          clickupStatus: raw.status?.status ?? null, clickupPriority: raw.priority?.priority ?? null,
          dueDate: clickupDate(raw.due_date), clickupCreatedAt: clickupDate(raw.date_created),
          clickupUpdatedAt: clickupDate(raw.date_updated), clickupUrl: raw.url ?? null,
          deleted: false, rawPayload: raw as Prisma.InputJsonValue
        };
        const task = await prisma.task.upsert({ where: { clickupTaskId: String(raw.id) }, update: taskData, create: { clickupTaskId: String(raw.id), ...taskData } });
        await prisma.taskAssignee.deleteMany({ where: { taskId: task.id } });
        for (const assignee of raw.assignees ?? []) {
          const employee = await prisma.employee.upsert({ where: { clickupUserId: String(assignee.id) }, update: { name: assignee.username || assignee.email || String(assignee.id), email: assignee.email ?? null, active: true }, create: { clickupUserId: String(assignee.id), name: assignee.username || assignee.email || String(assignee.id), email: assignee.email ?? null } });
          await prisma.taskAssignee.create({ data: { taskId: task.id, employeeId: employee.id } });
        }
        stats.successfulTasks += 1;
        await syncComments(task, stats);
        if ((taskIndex + 1) % 10 === 0 || taskIndex + 1 === rawTasks.length) console.log(`  Progress: ${taskIndex + 1}/${rawTasks.length} tasks`);
      } catch (error) {
        stats.failedTasks += 1;
        console.error(`TASK FAILURE | ${raw.id ?? 'unknown'} | ${raw.name ?? '(unnamed)'} | ${apiFailure(error)}`);
      }
    }
  }

  await prisma.client.update({ where: { id: client.id }, data: { lastSyncedAt: new Date() } });
  console.log('\nVOTH SYNC SUMMARY');
  console.log(`Lists: ${stats.lists}`);
  console.log(`Tasks: ${stats.tasks} (${stats.openTasks} open, ${stats.closedTasks} completed/closed)`);
  console.log(`Successful tasks: ${stats.successfulTasks}`);
  console.log(`Failed tasks: ${stats.failedTasks}`);
  console.log(`Comments imported: ${stats.comments}`);
  console.log(`Successful comment imports: ${stats.successfulCommentImports}`);
  console.log(`Failed comment imports: ${stats.failedCommentImports}`);
}

main().catch((error) => { console.error(`VOTH sync failed: ${apiFailure(error)}`); process.exitCode = 1; }).finally(() => prisma.$disconnect());
