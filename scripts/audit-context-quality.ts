import { loadEnvConfig } from '@next/env';
import { prisma } from '../lib/db/prisma';
import { analysisClientGroups } from '../lib/intelligence/client-scope';
import { buildTaskContext, contextText } from '../lib/intelligence/context';
import { findRelatedTasks, relatedEvidenceText } from '../lib/intelligence/related';
import { TASK_ANALYZER_SYSTEM } from '../lib/intelligence/prompt';

loadEnvConfig(process.cwd());
const args = process.argv.slice(2);
function arg(flag: string) { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; }
const slug = arg('--client');
if (!slug) throw new Error('Usage: npm run intelligence:audit-context -- --client CLIENT_SLUG [--top 10]');
const top = Number(arg('--top') ?? '10');
if (!Number.isInteger(top) || top < 1 || top > 50) throw new Error('--top must be an integer from 1 to 50');

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function fields(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(object) : [];
}
function isPopulated(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true; // 0 and false can be meaningful custom-field values.
}
const urlPattern = /https?:\/\/[^\s<>"']+/gi;
const externalFilePattern = /(?:drive\.google\.com|docs\.google\.com|dropbox\.com|sharepoint\.com|onedrive\.live\.com|\.pdf(?:[?#\s]|$)|\.docx?(?:[?#\s]|$)|\.xlsx?(?:[?#\s]|$))/i;

async function main() {
  const [group] = await analysisClientGroups({ clientSlug: slug });
  const tasks = await prisma.task.findMany({
    where: { clientId: { in: group.folders.map(folder => folder.id) }, deleted: false },
    include: { list: true, client: { select: { name: true } }, assignees: { include: { employee: true } }, comments: { orderBy: { clickupCreatedAt: 'asc' } } }
  });
  const contexts = tasks.map(buildTaskContext);
  const teamNames = (await prisma.employee.findMany({ select: { name: true } })).map(employee => employee.name);
  const sharedChars = TASK_ANALYZER_SYSTEM.length + 1000;
  const rows: Array<{ name: string; id: string; folder: string; list: string; tokens: number; comments: number; fields: number; populated: number; attachments: number; externalLinks: number }> = [];
  const folders = new Map<string, { tasks: number; fields: number; populated: number; attachmentRefs: number; linkHints: number }>();
  let totalFields = 0, populatedFields = 0, unsetFields = 0, attachmentRefs = 0, linkedDocumentHints = 0, tasksWithLinkHints = 0, tasksWithAttachments = 0, above8k = 0, above16k = 0, above32k = 0;
  const fieldStats = new Map<string, { total: number; populated: number }>();
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i], context = contexts[i], raw = object(task.rawPayload);
    const customFields = fields(raw.custom_fields);
    const populated = customFields.filter(field => isPopulated(field.value)).length;
    const attachments = Array.isArray(raw.attachments) ? raw.attachments.length : 0;
    for (const field of customFields) {
      const name = String(field.name ?? field.id ?? '(unnamed)');
      const stats = fieldStats.get(name) ?? { total: 0, populated: 0 };
      stats.total++;
      if (isPopulated(field.value)) stats.populated++;
      fieldStats.set(name, stats);
    }
    const body = [task.description ?? '', ...task.comments.map(comment => comment.body), typeof raw.markdown_description === 'string' ? raw.markdown_description : ''].join('\n');
    const links = body.match(urlPattern) ?? [];
    const documentHints = links.filter(link => externalFilePattern.test(link)).length;
    const related = findRelatedTasks(context, contexts);
    const payload = [
      'Analyze the current operational state of this ClickUp task. Comments are chronological, oldest to newest.',
      'Internal agency employees (not clients or vendors): ' + teamNames.join(', '),
      contextText(context),
      'Related task evidence (independent scope; do not assume shared completion):',
      relatedEvidenceText(related) || 'No strongly related tasks identified.'
    ].join('\n\n');
    // Matches estimator's 3 chars/token and 1.25 safety assumptions, with
    // a modest shared instruction allowance. This is NOT a tokenizer result.
    const tokens = Math.ceil((payload.length + sharedChars) / 3 * 1.25);
    totalFields += customFields.length;
    populatedFields += populated;
    unsetFields += customFields.length - populated;
    attachmentRefs += attachments;
    linkedDocumentHints += documentHints;
    if (documentHints) tasksWithLinkHints++;
    if (attachments) tasksWithAttachments++;
    if (tokens >= 8000) above8k++;
    if (tokens >= 16000) above16k++;
    if (tokens >= 32000) above32k++;
    const bucket = folders.get(task.client.name) ?? { tasks: 0, fields: 0, populated: 0, attachmentRefs: 0, linkHints: 0 };
    bucket.tasks++; bucket.fields += customFields.length; bucket.populated += populated; bucket.attachmentRefs += attachments; bucket.linkHints += documentHints;
    folders.set(task.client.name, bucket);
    rows.push({ name: task.name, id: task.clickupTaskId, folder: task.client.name, list: task.list.name, tokens, comments: task.comments.length, fields: customFields.length, populated, attachments, externalLinks: documentHints });
  }
  rows.sort((a,b) => b.tokens - a.tokens || a.id.localeCompare(b.id));
  console.log('READ-ONLY CLIENT CONTEXT QUALITY AUDIT: ' + group.canonical.name);
  console.log('Local PostgreSQL only. No ClickUp requests, OpenAI requests, or database writes.');
  console.log('TASKS ' + tasks.length + ' across ' + group.folders.length + ' consolidated folders');
  console.log('CUSTOM FIELDS ' + totalFields + ' entries | populated ' + populatedFields + ' | unset/empty ' + unsetFields + ' | populated ' + (totalFields ? (100 * populatedFields / totalFields).toFixed(1) : 'n/a') + '%');
  console.log('ATTACHMENTS stored refs ' + attachmentRefs + ' | tasks with refs ' + tasksWithAttachments);
  console.log('EXTERNAL DOCUMENT LINK HINTS ' + linkedDocumentHints + ' in ' + tasksWithLinkHints + ' tasks (URLs in descriptions/comments only; not file contents)');
  console.log('ESTIMATED INPUT SIZES >=8k: ' + above8k + ' | >=16k: ' + above16k + ' | >=32k: ' + above32k);
  console.log('Token estimates use 3 chars/token and 1.25x safety; not actual token counts. Model output and retries excluded.');
  console.log('\nFOLDER BREAKDOWN');
  for (const [name, data] of [...folders].sort((a,b) => a[0].localeCompare(b[0]))) console.log('  ' + name + ': ' + JSON.stringify(data));
  console.log('\nTOP ' + Math.min(top,rows.length) + ' LARGEST TASK INPUTS');
  for (const row of rows.slice(0,top)) console.log('  ' + row.tokens.toLocaleString() + ' est tokens | ' + row.name + ' [' + row.id + '] | ' + row.list + ' | comments ' + row.comments + ' | fields ' + row.populated + '/' + row.fields + ' | attachments ' + row.attachments + ' | doc-link hints ' + row.externalLinks);
  console.log('\nMOST FREQUENT CUSTOM FIELDS (top 12)');
  for (const [name, data] of [...fieldStats].sort((a,b) => b[1].total - a[1].total).slice(0,12)) console.log('  ' + name + ': ' + data.populated + '/' + data.total + ' populated');
  if (!attachmentRefs) console.log('\nATTACHMENT COVERAGE WARNING: Zero stored attachment refs is not evidence that ClickUp has no attachments. Compare a sample using clickup:audit-detail without --apply.');
  console.log('No changes made.');
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }).finally(() => prisma.$disconnect());
