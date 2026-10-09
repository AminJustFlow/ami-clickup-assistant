import { loadEnvConfig } from '@next/env';
import { prisma } from '../lib/db/prisma';
loadEnvConfig(process.cwd());
async function main() {
  const clients = await prisma.client.findMany({
    where: { active: true },
    select: { id: true, name: true, slug: true, clickupFolderId: true, space: { select: { name: true } }, _count: { select: { tasks: true } } },
    orderBy: [{ name: 'asc' }]
  });
  console.log('READ-ONLY IMPORTED FOLDER ORIGIN AUDIT (NO API OR DB WRITES)');
  const bySpace = new Map<string, typeof clients>();
  for (const client of clients) {
    const rows = bySpace.get(client.space.name) ?? [];
    rows.push(client);
    bySpace.set(client.space.name, rows);
  }
  for (const [space, rows] of bySpace) {
    console.log('\nSPACE: ' + space + ' | ' + rows.length + ' imported folders');
    for (const row of rows) {
      console.log('  ' + row.name + ' | ' + row._count.tasks + ' task records | folder ' + row.clickupFolderId + ' | ' + row.slug);
    }
  }
  console.log('\nNote: task records include deleted rows. The audit only reports database origin; it does not infer folder ownership.');
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
