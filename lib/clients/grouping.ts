/**
 * Conservative read-only grouping of ClickUp folders that belong to one real client.
 * The database keeps every original folder, list and task unchanged.
 * Only an explicit acronym in the canonical client name can link an ancillary folder.
 * Ambiguous acronyms are not grouped.
 */
export type ClientFolder = { id: number; name: string; slug: string };
export type ClientGroup = { canonical: ClientFolder; folders: ClientFolder[] };

const canonicalCode = (name: string): string | null => {
  const match = name.match(/\(([A-Za-z0-9]{2,6})\)\s*$/);
  return match ? match[1].toUpperCase() : null;
};
const auxiliaryCode = (name: string): string | null => {
  const match = name.match(/^([A-Za-z0-9]{2,6})\s+(?:Invoic(?:ed|ing)(?: Projects)?|Monthly Budget|NO GO Projects)\s*$/i);
  return match ? match[1].toUpperCase() : null;
};

export function groupClientFolders(clients: ClientFolder[]): ClientGroup[] {
  const byCode = new Map<string, ClientFolder[]>();
  for (const client of clients) {
    const code = canonicalCode(client.name);
    if (!code || auxiliaryCode(client.name)) continue;
    const matches = byCode.get(code) ?? [];
    matches.push(client);
    byCode.set(code, matches);
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

/**
 * Folders whose names do not identify an actual client. Keep them accessible
 * for manual attribution, but never count them as standalone client accounts.
 */
export function needsClientAttribution(name: string): boolean {
  return /^(?:invoiced projects|jf invoiced projects)$/i.test(name.trim());
}
