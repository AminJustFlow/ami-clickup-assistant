import { loadEnvConfig } from '@next/env';
import { prisma } from '../lib/db/prisma';
import { groupClientFolders, needsClientAttribution } from '../lib/clients/grouping';

loadEnvConfig(process.cwd());
async function main() {
  const folders = await prisma.client.findMany({
    where: { active: true, space: { name: 'JF Corporate' } },
    select: { id: true, name: true, slug: true, clickupFolderId: true }
  });
  const groups = groupClientFolders(folders);
  const unknown = groups.filter(group => needsClientAttribution(group.canonical.name)).map(group => group.canonical);
  const attributed = folders.filter(folder => needsClientAttribution(folder.name) && !unknown.some(item => item.id === folder.id));
  console.log('Attributed generic invoicing folders: ' + attributed.length + '; still unattributed: ' + unknown.length);
  for (const folder of attributed) {
    const group = groups.find(group => group.folders.some(item => item.id === folder.id));
    console.log('  VERIFIED: folder ' + folder.clickupFolderId + ' -> ' + group?.canonical.name);
  }
  console.log('READ-ONLY UNATTRIBUTED INVOICING FOLDER REVIEW');
  console.log('No ClickUp API calls, OpenAI calls or database changes.');
  for (const folder of unknown) {
    const lists = await prisma.clickUpList.findMany({
      where: { clientId: folder.id },
      select: { id: true, name: true, _count: { select: { tasks: true } } },
      orderBy: { name: 'asc' }
    });
    const tasks = await prisma.task.findMany({
      where: { clientId: folder.id, deleted: false },
      select: { name: true, description: true },
      orderBy: { clickupUpdatedAt: 'desc' },
      take: 8
    });
    console.log('\n' + folder.name + ' | folder ' + folder.clickupFolderId + ' | ' + folder.slug);
    console.log('  LISTS: ' + (lists.map(list => list.name + ' (' + list._count.tasks + ')').join(' ; ') || '(none)'));
    for (const task of tasks) {
      console.log('  TASK: ' + task.name.slice(0, 160));
      if (task.description) console.log('    DESCRIPTION: ' + task.description.replace(/\s+/g, ' ').slice(0, 150));
    }
  }
  console.log('\nThese samples are clues only. Do not assign folders without confirming their owner.');
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
