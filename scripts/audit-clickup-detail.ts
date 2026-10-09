import { loadEnvConfig } from '@next/env';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/db/prisma';
import { getTask } from '../lib/clickup/client';
import { rawEvidence } from '../lib/intelligence/context';

loadEnvConfig(process.cwd());
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
function value(name: string) { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; }
const apply = flag('--apply');
const clientSlug = value('--client');
const withChecklists = flag('--with-checklists');
const withDependencies = flag('--with-dependencies');
const withAttachments = flag('--with-attachments');
const filters = Number(withChecklists) + Number(withDependencies) + Number(withAttachments);
if (filters > 1) throw new Error('Use only one of --with-checklists, --with-dependencies, --with-attachments.');
const limit = Number(value('--limit') ?? '5');
if (!Number.isInteger(limit) || limit < 1 || limit > 10000) throw new Error('--limit must be an integer between 1 and 10000');
if (apply && !clientSlug) throw new Error('For safety, --apply requires --client SLUG. Enrich one client at a time.');
if (apply && !flag('--confirm')) throw new Error('For safety, --apply requires --confirm.');
async function main() {
  const candidates = await prisma.task.findMany({
    where: { deleted: false, ...(clientSlug ? { client: { slug: clientSlug } } : {}) },
    select: { id: true, clickupTaskId: true, name: true, rawPayload: true, client: { select: { name: true } } },
    orderBy: { clickupUpdatedAt: 'desc' },
    ...(filters ? {} : { take: limit })
  });
  const tasks = (filters ? candidates.filter(task => {
    const c = rawEvidence(task.rawPayload).coverage;
    return withChecklists ? c.checklistItems > 0 : withDependencies ? c.dependencies > 0 : c.attachments > 0;
  }).slice(0, limit) : candidates);
  console.log('CLICKUP FULL-TASK COVERAGE AUDIT (' + (apply ? 'ENRICH LOCAL DB' : 'READ-ONLY SAMPLE') + ')');
  console.log('Selected: ' + tasks.length + ' tasks. No OpenAI calls.');
  if (filters && !tasks.length) console.log('No stored tasks matched the requested evidence filter; this does not establish that ClickUp contains none.');
  let changed = 0, errors = 0;
  for (const task of tasks) {
    try {
      const raw = await getTask(task.clickupTaskId);
      if (!raw || String(raw.id) !== task.clickupTaskId) throw new Error('Unexpected ClickUp task ID');
      const before = rawEvidence(task.rawPayload).coverage;
      const after = rawEvidence(raw).coverage;
      console.log(task.client.name + ' / ' + task.name + ' [' + task.clickupTaskId + ']');
      console.log('  stored: ' + JSON.stringify(before));
      console.log('  live:   ' + JSON.stringify(after));
      const populated = (value: unknown) => Array.isArray(value) ? value.filter(field => field && typeof field === 'object' && 'value' in field && (field as {value: unknown}).value != null && (field as {value: unknown}).value !== '').length : 0;
      const storedRaw = task.rawPayload && typeof task.rawPayload === 'object' && !Array.isArray(task.rawPayload) ? task.rawPayload as Record<string, unknown> : {};
      console.log('  populated custom fields: stored ' + populated(storedRaw.custom_fields) + ', live ' + populated(raw.custom_fields));
      if (JSON.stringify(before) !== JSON.stringify(after)) console.log('  DIFFERENCE: stored and live evidence counts do not match');
      if (apply) {
        // Merge complete detail into the existing raw payload without touching comments or AI.
        const previous = task.rawPayload && typeof task.rawPayload === 'object' && !Array.isArray(task.rawPayload)
          ? task.rawPayload as Record<string, unknown> : {};
        const merged = { ...previous, ...raw, _fullTaskFetchedAt: new Date().toISOString() };
        await prisma.task.update({
          where: { id: task.id },
          data: {
            rawPayload: merged as Prisma.InputJsonValue,
            description: typeof raw.description === 'string' ? raw.description : (typeof raw.text_content === 'string' ? raw.text_content : undefined)
          }
        });
        changed++;
      }
    } catch (error) {
      errors++;
      console.error('  ERROR ' + task.clickupTaskId + ': ' + (error instanceof Error ? error.message : String(error)));
    }
  }
  console.log('RESULT: inspected ' + tasks.length + ', enriched ' + changed + ', errors ' + errors);
  if (!apply) console.log('Read-only. To enrich one client, pass --client SLUG --limit N --apply --confirm.');
  if (errors) process.exitCode = 1;
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
