import { prisma } from '../db/prisma';
import { groupClientFolders } from '../clients/grouping';

/**
 * Both the paid analyzer and the dry-run estimator must use the same
 * consolidated client scope. No database rows are reassigned.
 */
export async function analysisClientGroups(options: { clientSlug?: string; includeVoth?: boolean }) {
  const folders = await prisma.client.findMany({
    where: { active: true, space: { name: 'JF Corporate' } },
    select: { id: true, slug: true, name: true, clickupFolderId: true }
  });
  const groups = groupClientFolders(folders);
  if (options.clientSlug) {
    const group = groups.find(group => group.folders.some(folder => folder.slug === options.clientSlug));
    if (!group) throw new Error('Client not found in JF Corporate: ' + options.clientSlug);
    return [group];
  }
  return groups.filter(group => options.includeVoth || !group.folders.some(folder => folder.slug === 'voth'))
    .sort((a, b) => a.canonical.name.localeCompare(b.canonical.name));
}
