import { loadEnvConfig } from '@next/env';
import { prisma } from '../lib/db/prisma';
import { groupClientFolders } from '../lib/clients/grouping';
import { rawEvidence } from '../lib/intelligence/context';

loadEnvConfig(process.cwd());
const args = process.argv.slice(2);
function value(flag: string) { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; }
const clientSlug = value('--client');
const limit = Number(value('--limit') ?? '20');
if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('--limit must be 1 to 1000');
function dependencyIds(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const data = raw as Record<string, unknown>;
  if (!Array.isArray(data.dependencies)) return [];
  return data.dependencies.flatMap(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const dependency = value as Record<string, unknown>;
    return [dependency.task_id, dependency.depends_on]
      .filter((id): id is string | number => typeof id === 'string' || typeof id === 'number')
      .map(String);
  });
}
async function main() {
  const clients = await prisma.client.findMany({ where: { active: true }, select: { id: true, slug: true, name: true } });
  const groups = groupClientFolders(clients);
  const selected = clientSlug ? groups.filter(group => group.folders.some(folder => folder.slug === clientSlug)) : groups.filter(group => group.folders.length > 1).slice(0, limit);
  if (clientSlug && !selected.length) throw new Error('Client folder not found: ' + clientSlug);
  console.log('READ-ONLY CLIENT GROUP / DEPENDENCY / ATTACHMENT AUDIT (NO AI, NO DATABASE WRITES)');
  console.log('Grouping requires an unambiguous acronym; no guessed cross-client links.');
  for (const group of selected) {
    console.log('\n' + group.canonical.name + ' [' + group.canonical.slug + ']');
    for (const folder of group.folders) console.log('  FOLDER ' + folder.name + ' [' + folder.slug + ']');
    const tasks = await prisma.task.findMany({
      where: { deleted: false, clientId: { in: group.folders.map(folder => folder.id) } },
      select: { clickupTaskId: true, name: true, rawPayload: true, client: { select: { name: true } } }
    });
    const taskById = new Map(tasks.map(task => [task.clickupTaskId, task]));
    const referenced = new Set<string>();
    let dependencyRecords = 0, attachments = 0, checklistItems = 0, customFields = 0;
    for (const task of tasks) {
      const coverage = rawEvidence(task.rawPayload).coverage;
      dependencyRecords += coverage.dependencies;
      attachments += coverage.attachments;
      checklistItems += coverage.checklistItems;
      customFields += coverage.customFields;
      for (const id of dependencyIds(task.rawPayload)) if (id !== task.clickupTaskId) referenced.add(id);
    }
    const unresolved = [...referenced].filter(id => !taskById.has(id));
    const crossFolder = [...referenced].filter(id => {
      const source = taskById.get(id);
      return source && tasks.some(task => dependencyIds(task.rawPayload).includes(id) && task.client.name !== source.client.name);
    });
    console.log('  TASKS ' + tasks.length + ' | CHECKLIST ITEMS ' + checklistItems + ' | CUSTOM FIELD ENTRIES ' + customFields + ' | ATTACHMENT REFS ' + attachments);
    console.log('  DEPENDENCY RECORDS ' + dependencyRecords + ' | REFERENCED IDS ' + referenced.size + ' | RESOLVED IN GROUP ' + (referenced.size - unresolved.length) + ' | CROSS-FOLDER LINKS ' + crossFolder.length + ' | OUTSIDE GROUP/NOT IMPORTED ' + unresolved.length);
    if (unresolved.length) console.log('  SAMPLE UNRESOLVED IDs: ' + unresolved.slice(0, 10).join(', '));
    if (crossFolder.length) console.log('  SAMPLE CROSS-FOLDER LINKS: ' + crossFolder.slice(0, 10).join(', '));
  }
  console.log('\nNo changes made. References outside this group may exist elsewhere in the imported workspace.');
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
