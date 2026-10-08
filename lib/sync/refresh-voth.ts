import type { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { getFolderLists, getTask, getTaskComments, getCommentReplies, getTasks } from '../clickup/client';
import { clickupDate, commentPlainText } from '../clickup/raw';
import { buildTaskContext } from '../intelligence/context';
import { intelligenceFingerprint } from '../intelligence/fingerprint';
import { findRelatedTasks } from '../intelligence/related';
import { analyzeWithAI, DEFAULT_INTELLIGENCE_MODEL } from '../intelligence/ai';
import { saveTaskIntelligence } from '../intelligence/change-history';
import { TASK_ANALYZER_PROMPT_VERSION } from '../intelligence/prompt';

const CLIENT_SLUG = 'voth';
const PAGE_LIMIT = 100;
const COMMENT_PAGE_SIZE = 25;

async function allComments(taskId: string): Promise<Record<string, any>[]> {
  const result: Record<string, any>[] = [];
  let cursor: { start: string; startId: string } | undefined;
  const seen = new Set<string>();
  for (;;) {
    const response = await getTaskComments(taskId, cursor);
    const page = response.comments ?? [];
    result.push(...page);
    if (page.length < COMMENT_PAGE_SIZE) return result;
    const last = page.at(-1);
    if (!last?.id || !last?.date) return result;
    const key = String(last.id) + ':' + String(last.date);
    if (seen.has(key)) throw new Error('Repeated ClickUp comment pagination cursor');
    seen.add(key);
    cursor = { start: String(last.date), startId: String(last.id) };
  }
}

async function importComments(taskId: number, clickupId: string) {
  const parents = await allComments(clickupId);
  for (const parent of parents) {
    const replies = await getCommentReplies(String(parent.id));
    for (const raw of [parent, ...(replies.comments ?? [])]) {
      const user = raw.user && typeof raw.user === 'object' ? raw.user : {};
      await prisma.comment.upsert({
        where: { clickupCommentId: String(raw.id) },
        create: {
          clickupCommentId: String(raw.id), taskId,
          authorClickupId: user.id == null ? null : String(user.id),
          authorName: typeof user.username === 'string' ? user.username : null,
          body: commentPlainText(raw),
          clickupCreatedAt: clickupDate(raw.date),
          clickupUpdatedAt: clickupDate(raw.date_updated),
          rawPayload: raw as Prisma.InputJsonValue
        },
        update: {
          taskId, authorClickupId: user.id == null ? null : String(user.id),
          authorName: typeof user.username === 'string' ? user.username : null,
          body: commentPlainText(raw),
          clickupCreatedAt: clickupDate(raw.date),
          clickupUpdatedAt: clickupDate(raw.date_updated),
          rawPayload: raw as Prisma.InputJsonValue
        }
      });
    }
  }
}

async function importTask(raw: Record<string, any>, clientId: number, listId: number): Promise<number> {
  const clickupId = String(raw.id);
  const data = {
    clientId, listId,
    name: String(raw.name ?? raw.id),
    description: raw.description || raw.text_content || null,
    clickupStatus: raw.status?.status ?? null,
    clickupPriority: raw.priority?.priority ?? null,
    dueDate: clickupDate(raw.due_date),
    clickupCreatedAt: clickupDate(raw.date_created),
    clickupUpdatedAt: clickupDate(raw.date_updated),
    clickupUrl: raw.url ?? null,
    deleted: false,
    rawPayload: raw as Prisma.InputJsonValue
  };
  const task = await prisma.task.upsert({
    where: { clickupTaskId: clickupId },
    create: { clickupTaskId: clickupId, ...data },
    update: data
  });
  await prisma.taskAssignee.deleteMany({ where: { taskId: task.id } });
  for (const person of raw.assignees ?? []) {
    const employee = await prisma.employee.upsert({
      where: { clickupUserId: String(person.id) },
      create: { clickupUserId: String(person.id), name: person.username || person.email || String(person.id), email: person.email ?? null },
      update: { name: person.username || person.email || String(person.id), email: person.email ?? null, active: true }
    });
    await prisma.taskAssignee.create({ data: { taskId: task.id, employeeId: employee.id } });
  }
  await importComments(task.id, clickupId);
  return task.id;
}

export type RefreshResult = {
  scanned: number;
  refreshed: number;
  analyzed: number;
  cached: number;
  failed: number;
  errors: string[];
};

/** Read-only against ClickUp; only updates our local database. */
export async function refreshVoth(): Promise<RefreshResult> {
  if (!process.env.CLICKUP_API_TOKEN) throw new Error('CLICKUP_API_TOKEN is missing');
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is missing');
  const client = await prisma.client.findUnique({ where: { slug: CLIENT_SLUG } });
  if (!client) throw new Error('VOTH is not initialized. Run clickup:sync:voth first.');

  const stats: RefreshResult = { scanned: 0, refreshed: 0, analyzed: 0, cached: 0, failed: 0, errors: [] };
  const changedIds = new Set<number>();
  const failedIds = new Set<string>();
  const pendingEvents = await prisma.taskEvent.findMany({
    where: { processedAt: null, eventType: { not: 'unknown' } },
    orderBy: { createdAt: 'asc' },
    take: 500
  });
  const pendingByTask = new Map<string, number[]>();
  for (const event of pendingEvents) {
    const payload = event.rawPayload as Record<string, unknown>;
    const id = typeof payload.task_id === 'string' || typeof payload.task_id === 'number' ? String(payload.task_id) : null;
    if (!id) continue;
    const ids = pendingByTask.get(id) ?? [];
    ids.push(event.id);
    pendingByTask.set(id, ids);
  }

  const liveLists = await getFolderLists(client.clickupFolderId);
  const listIds = new Map<string, number>();
  for (const list of liveLists.lists) {
    const row = await prisma.clickUpList.upsert({
      where: { clickupListId: String(list.id) },
      create: { clickupListId: String(list.id), clientId: client.id, name: list.name, active: true },
      update: { clientId: client.id, name: list.name, active: true }
    });
    listIds.set(String(list.id), row.id);
  }

  const refreshedClickupIds = new Set<string>();
  const seenClickupIds = new Set<string>();
  for (const [clickupListId, localListId] of listIds) {
    for (let page = 0; ; page++) {
      const response = await getTasks(clickupListId, page);
      const raws = response.tasks ?? [];
      stats.scanned += raws.length;
      const known = await prisma.task.findMany({
        where: { clickupTaskId: { in: raws.map(t => String(t.id)) } },
        select: { clickupTaskId: true, clickupUpdatedAt: true, id: true, listId: true }
      });
      const byId = new Map(known.map(t => [t.clickupTaskId, t]));
      for (const raw of raws) {
        const id = String(raw.id);
        seenClickupIds.add(id);
        const prior = byId.get(id);
        const updated = clickupDate(raw.date_updated);
        const changed = !prior || prior.listId !== localListId || prior.clickupUpdatedAt?.getTime() !== updated?.getTime() || pendingByTask.has(id);
        if (!changed) continue;
        try {
          const taskId = await importTask(raw, client.id, localListId);
          changedIds.add(taskId);
          refreshedClickupIds.add(id);
          stats.refreshed++;
        } catch (error) {
          failedIds.add(id);
          // Persist a retry marker so an unchanged ClickUp timestamp cannot hide
          // a partially imported task on the next polling cycle.
          await prisma.taskEvent.upsert({
            where: { eventKey: 'sync-retry:' + id + ':' + String(raw.date_updated ?? 'none') },
            create: { eventKey: 'sync-retry:' + id + ':' + String(raw.date_updated ?? 'none'), eventType: 'refreshRetry', rawPayload: { task_id: id } },
            update: { processedAt: null }
          });
          stats.failed++;
          stats.errors.push('Task ' + id + ': ' + (error instanceof Error ? error.message : String(error)));
        }
      }
      if (raws.length < PAGE_LIMIT) break;
    }
  }

  // Mark tasks absent from a complete successful list scan as deleted locally.
  // This never deletes anything in ClickUp.
  await prisma.task.updateMany({ where: { clientId: client.id, clickupTaskId: { notIn: [...seenClickupIds] }, deleted: false }, data: { deleted: true } });

  // Handle webhook updates even when the task's date_updated did not change.
  for (const [id] of pendingByTask) {
    if (refreshedClickupIds.has(id) || failedIds.has(id)) continue;
    const local = await prisma.task.findUnique({ where: { clickupTaskId: id }, select: { id: true, clientId: true, listId: true } });
    if (!local || local.clientId !== client.id) continue;
    try {
      const raw = await getTask(id);
      const targetList = listIds.get(String(raw.list?.id)) ?? local.listId;
      changedIds.add(await importTask(raw, client.id, targetList));
      stats.refreshed++;
      refreshedClickupIds.add(id);
    } catch (error) {
      failedIds.add(id);
      stats.failed++;
      stats.errors.push('Webhook task ' + id + ': ' + (error instanceof Error ? error.message : String(error)));
    }
  }

  const tasks = await prisma.task.findMany({
    where: { clientId: client.id, deleted: false },
    include: { list: true, intelligence: true, assignees: { include: { employee: true } }, comments: { orderBy: { clickupCreatedAt: 'asc' } } }
  });
  const contexts = tasks.map(buildTaskContext);
  const teamNames = (await prisma.employee.findMany({ select: { name: true } })).map(x => x.name);
  const model = process.env.OPENAI_INTELLIGENCE_MODEL ?? DEFAULT_INTELLIGENCE_MODEL;
  const expectedVersion = TASK_ANALYZER_PROMPT_VERSION + ':' + model;

  for (const task of tasks) {
    const context = buildTaskContext(task);
    const related = findRelatedTasks(context, contexts);
    const fingerprint = intelligenceFingerprint(context, model, teamNames, related);
    if (task.intelligence?.sourceFingerprint === fingerprint && task.intelligence.promptVersion === expectedVersion) {
      stats.cached++;
      continue;
    }
    try {
      const result = await analyzeWithAI(context, { teamNames, model, related });
      if (result.source !== 'AI') throw new Error('AI unavailable; retaining previous intelligence and retrying next run');
      await saveTaskIntelligence(task.id, {
        agentState: result.agentState, headline: result.headline,
        currentSummary: result.currentSummary, needsAmi: result.needsAmi, amiAction: result.amiAction,
        waitingOnType: result.waitingOnType, waitingOnName: result.waitingOnName,
        importanceScore: result.importanceScore, amiAttentionScore: result.amiAttentionScore,
        riskLevel: result.riskLevel, lastMeaningfulChange: result.lastMeaningfulChange,
        lastMeaningfulChangeAt: result.lastMeaningfulChangeAt, confidence: result.confidence,
        promptVersion: expectedVersion, analyzedAt: new Date(), sourceFingerprint: fingerprint
      });
      stats.analyzed++;
    } catch (error) {
      stats.failed++;
      stats.errors.push('AI ' + task.clickupTaskId + ': ' + (error instanceof Error ? error.message : String(error)));
      failedIds.add(task.clickupTaskId);
    }
  }

  // Only acknowledge webhook events after their task refresh AND AI analysis succeeded.
  for (const [clickupId, eventIds] of pendingByTask) {
    if (failedIds.has(clickupId)) continue;
    if (!refreshedClickupIds.has(clickupId)) continue;
    await prisma.taskEvent.updateMany({ where: { id: { in: eventIds }, processedAt: null }, data: { processedAt: new Date() } });
  }

  if (stats.failed === 0) await prisma.client.update({ where: { id: client.id }, data: { lastSyncedAt: new Date() } });
  return stats;
}
