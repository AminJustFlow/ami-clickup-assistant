import fs from 'node:fs/promises';
import path from 'node:path';

export interface DiscoveryList { id: string; name: string }
export interface DiscoveryFolder { id: string; name: string; lists: DiscoveryList[] }
export interface DiscoverySpace { id: string; name: string; folders: DiscoveryFolder[]; folderlessLists: DiscoveryList[] }
export interface ClickUpDiscovery {
  workspace: { id: string; name: string };
  spaces: DiscoverySpace[];
}

export interface ResolvedClientFolder {
  workspace: { id: string; name: string };
  space: { id: string; name: string };
  folder: DiscoveryFolder;
}

export async function readDiscovery(): Promise<ClickUpDiscovery> {
  const file = path.join(process.cwd(), 'data', 'clickup-discovery.json');
  return JSON.parse(await fs.readFile(file, 'utf8')) as ClickUpDiscovery;
}

export async function resolveClientFolder(selector: { id?: string; exactName?: string }): Promise<ResolvedClientFolder> {
  if (!selector.id && !selector.exactName) throw new Error('A ClickUp Folder ID or exact Folder name is required');
  const discovery = await readDiscovery();
  const matches = discovery.spaces.flatMap((space) => space.folders
    .filter((folder) => selector.id ? folder.id === selector.id : folder.name === selector.exactName)
    .map((folder) => ({ workspace: discovery.workspace, space: { id: space.id, name: space.name }, folder })));
  if (!matches.length) throw new Error(`Client Folder not found in discovery data: ${selector.id ?? selector.exactName}`);
  if (matches.length > 1) throw new Error(`Client Folder selector is ambiguous: ${selector.id ?? selector.exactName}`);
  return matches[0];
}
