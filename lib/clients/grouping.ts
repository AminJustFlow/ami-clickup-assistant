/**
 * Group client-specific ClickUp folders for presentation without changing
 * any source folder, task or database relationship.
 *
 * Matching requires a unique explicit code from the canonical folder name.
 * Ambiguous generic "Invoiced Projects" folders are never assigned.
 */
export type ClientFolder = { id: number; name: string; slug: string };
export type ClientGroup = { canonical: ClientFolder; folders: ClientFolder[] };

const auxiliaryCode = (name: string): string | null => {
  const match = name.trim().match(/^([A-Za-z0-9]{2,6})\s+(?:Invoic(?:ed|ing)(?: Projects)?|Monthly Budget|NO GO Projects)\s*$/i);
  return match ? match[1].toUpperCase() : null;
};

const canonicalCodes = (name: string): string[] => {
  if (auxiliaryCode(name) || needsClientAttribution(name)) return [];
  const matches = [...name.matchAll(/\(([A-Za-z0-9]{2,6})\)/g)].map(match => match[1].toUpperCase());
  // Explicit legacy folder names whose client code is not in parentheses.
  if (name.trim().toLowerCase() === 'just flow') matches.push('JF');
  return [...new Set(matches)];
};

export function needsClientAttribution(name: string): boolean {
  return /^(?:invoiced projects)$/i.test(name.trim());
}

export function groupClientFolders(clients: ClientFolder[]): ClientGroup[] {
  const byCode = new Map<string, ClientFolder[]>();
  for (const client of clients) {
    for (const code of canonicalCodes(client.name)) {
      const matches = byCode.get(code) ?? [];
      matches.push(client);
      byCode.set(code, matches);
    }
  }
  const groups = new Map<number, ClientGroup>();
  for (const client of clients) groups.set(client.id, { canonical: client, folders: [client] });
  for (const folder of clients) {
    const code = auxiliaryCode(folder.name);
    if (!code) continue;
    const matches = byCode.get(code) ?? [];
    if (matches.length !== 1) continue;
    const canonical = matches[0];
    if (canonical.id === folder.id) continue;
    groups.delete(folder.id);
    groups.get(canonical.id)?.folders.push(folder);
  }
  return [...groups.values()].map(group => ({
    ...group,
    folders: [group.canonical, ...group.folders.filter(folder => folder.id !== group.canonical.id).sort((a,b) => a.name.localeCompare(b.name))]
  }));
}

export function foldersForClient(clients: ClientFolder[], slug: string): ClientFolder[] {
  const groups = groupClientFolders(clients);
  const group = groups.find(item => item.folders.some(folder => folder.slug === slug));
  return group?.folders ?? clients.filter(folder => folder.slug === slug);
}
