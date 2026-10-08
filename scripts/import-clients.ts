import { loadEnvConfig } from '@next/env';
import { prisma } from '../lib/db/prisma';
import { getFolderLists, getFolders, getSpaces, getTasks } from '../lib/clickup/client';
import { importTask } from '../lib/sync/refresh-voth';

loadEnvConfig(process.cwd());

type FolderPlan = { spaceId: string; spaceName: string; folderId: string; folderName: string; listCount: number };
const args = process.argv.slice(2);
const has = (flag: string) => args.includes(flag);
function value(flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i < 0 ? undefined : args[i + 1];
}
const apply = has('--apply');
const includeVoth = has('--include-voth');
const folderId = value('--folder-id');
const spaceId = value('--space-id');
const limitArg = value('--limit-clients');
const limit = limitArg ? Number(limitArg) : Infinity;
if (limitArg && (!Number.isInteger(limit) || limit < 1)) throw new Error('--limit-clients must be a positive integer');

function slugify(name: string, id: string): string {
  const base = name.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 45) || 'client';
  return base + '-' + id.toLowerCase().replace(/[^a-z0-9]/g, '').slice(-12);
}

async function main() {
  const workspaceId = process.env.CLICKUP_WORKSPACE_ID?.trim();
  if (!workspaceId) throw new Error('CLICKUP_WORKSPACE_ID is required');
  if (!process.env.CLICKUP_API_TOKEN) throw new Error('CLICKUP_API_TOKEN is required');
  const spaces = await getSpaces(workspaceId);
  const plans: FolderPlan[] = [];
  for (const space of spaces.spaces) {
    if (spaceId && String(space.id) !== spaceId) continue;
    const { folders } = await getFolders(String(space.id));
    for (const folder of folders) {
      if (folderId && String(folder.id) !== folderId) continue;
      if (!includeVoth && /the village on technology hill/i.test(folder.name)) continue;
      if (!(folder.lists ?? []).length) continue;
      plans.push({
        spaceId: String(space.id), spaceName: space.name,
        folderId: String(folder.id), folderName: folder.name, listCount: folder.lists?.length ?? 0
      });
    }
  }
  plans.sort((a, b) => a.spaceName.localeCompare(b.spaceName) || a.folderName.localeCompare(b.folderName));
  const selected = plans.slice(0, limit);
  console.log('\nCLICKUP CLIENT FOLDER PLAN (' + (apply ? 'IMPORT' : 'PREVIEW ONLY') + ')');
  for (const plan of selected) console.log(plan.spaceName + ' / ' + plan.folderName + ' | folder ' + plan.folderId + ' | ' + plan.listCount + ' lists');
  console.log('Selected: ' + selected.length + ' folders; available: ' + plans.length);
  console.log('Folderless Lists are excluded. VOTH is excluded unless --include-voth is supplied.');
  if (!apply) {
    console.log('\nNo changes made. Inspect this list, then run with --apply to import.');
    return;
  }
  if (!selected.length) throw new Error('No client folders selected');
  const workspace = await prisma.workspace.upsert({
    where: { clickupWorkspaceId: workspaceId },
    create: { clickupWorkspaceId: workspaceId, name: spaces.spaces[0]?.name ? 'ClickUp workspace ' + workspaceId : workspaceId },
    update: {}
  });
  let succeeded = 0, failed = 0, tasksImported = 0;
  for (const plan of selected) {
    console.log('\nIMPORT ' + plan.spaceName + ' / ' + plan.folderName);
    try {
      await prisma.space.upsert({
        where: { clickupSpaceId: plan.spaceId },
        create: { clickupSpaceId: plan.spaceId, workspaceId: workspace.id, name: plan.spaceName },
        update: { workspaceId: workspace.id, name: plan.spaceName }
      });
      const existing = await prisma.client.findUnique({ where: { clickupFolderId: plan.folderId } });
      const slug = existing?.slug ?? slugify(plan.folderName, plan.folderId);
      const client = await prisma.client.upsert({
        where: { clickupFolderId: plan.folderId },
        create: { clickupFolderId: plan.folderId, clickupSpaceId: plan.spaceId, name: plan.folderName, slug, active: true },
        update: { clickupSpaceId: plan.spaceId, name: plan.folderName, active: true }
      });
      const liveLists = await getFolderLists(plan.folderId);
      if (!liveLists.lists?.length) throw new Error('No Lists returned; leaving existing data untouched');
      const seen = new Set<string>();
      let folderErrors = 0;
      for (const rawList of liveLists.lists) {
        const list = await prisma.clickUpList.upsert({
          where: { clickupListId: String(rawList.id) },
          create: { clickupListId: String(rawList.id), clientId: client.id, name: rawList.name, active: true },
          update: { clientId: client.id, name: rawList.name, active: true }
        });
        let count = 0;
        try {
          for (let page = 0; ; page++) {
            const response = await getTasks(list.clickupListId, page);
            for (const raw of response.tasks) {
              seen.add(String(raw.id));
              try { await importTask(raw, client.id, list.id); tasksImported++; count++; }
              catch (error) {
                folderErrors++;
                console.error('  Task ' + String(raw.id) + ': ' + (error instanceof Error ? error.message : String(error)));
              }
            }
            if (response.tasks.length < 100) break;
          }
          console.log('  ' + list.name + ': ' + count + ' tasks');
        } catch (error) {
          folderErrors++;
          console.error('  List ' + list.name + ': ' + (error instanceof Error ? error.message : String(error)));
        }
      }
      if (folderErrors === 0) {
        await prisma.task.updateMany({
          where: { clientId: client.id, deleted: false, clickupTaskId: { notIn: [...seen] } },
          data: { deleted: true }
        });
        await prisma.client.update({ where: { id: client.id }, data: { lastSyncedAt: new Date() } });
        succeeded++;
      } else {
        failed++;
        console.error('  ' + folderErrors + ' import errors. Existing tasks were not marked deleted; sync timestamp not advanced.');
      }
    } catch (error) {
      failed++;
      console.error('  CLIENT FAILED: ' + (error instanceof Error ? error.message : String(error)));
    }
  }
  console.log('\nRESULT: ' + succeeded + ' clients succeeded, ' + failed + ' clients with errors, ' + tasksImported + ' tasks imported.');
  if (failed) process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
