import fs from 'node:fs/promises';
import path from 'node:path';
import { loadEnvConfig } from '@next/env';
import { ClickUpApiError, getFolderlessLists, getFolders, getList, getSpaces, getTeams } from '../lib/clickup/client';

const KNOWN_LIST_ID = '901413054565';
const OUTPUT_PATH = path.join(process.cwd(), 'data', 'clickup-discovery.json');
const OPERATIONAL_LIST_PATTERN = /ami|notifications?/i;

interface DiscoveredList { id: string; name: string }
interface DiscoveredFolder { id: string; name: string; lists: DiscoveredList[] }
interface DiscoveredSpace { id: string; name: string; folders: DiscoveredFolder[]; folderlessLists: DiscoveredList[] }
interface OperationalMatch extends DiscoveredList { space: DiscoveredList; folder: DiscoveredList | null }

function requireWorkspaceId(): string {
  const workspaceId = process.env.CLICKUP_WORKSPACE_ID?.trim();
  if (!workspaceId) throw new Error('CLICKUP_WORKSPACE_ID is not configured');
  return workspaceId;
}

function printList(list: DiscoveredList, indent: string): void {
  console.log(`${indent}LIST: ${list.name}`);
  console.log(`${indent}ID: ${list.id}`);
}

function printHierarchy(spaces: DiscoveredSpace[]): void {
  console.log('\n====================================');
  console.log('WORKSPACE HIERARCHY');
  console.log('====================================');
  for (const space of spaces) {
    console.log(`\nSPACE: ${space.name}`);
    console.log(`ID: ${space.id}`);
    for (const folder of space.folders) {
      console.log(`\n  FOLDER: ${folder.name}`);
      console.log(`  ID: ${folder.id}`);
      if (!folder.lists.length) console.log('    (No Lists)');
      for (const list of folder.lists) {
        console.log('');
        printList(list, '    ');
      }
    }
    if (space.folderlessLists.length) {
      console.log('\n  FOLDERLESS LISTS');
      for (const list of space.folderlessLists) {
        console.log('');
        printList(list, '    ');
      }
    }
  }
}

function findOperationalLists(spaces: DiscoveredSpace[]): OperationalMatch[] {
  return spaces.flatMap((space) => [
    ...space.folders.flatMap((folder) => folder.lists
      .filter((list) => OPERATIONAL_LIST_PATTERN.test(list.name))
      .map((list) => ({ ...list, space: { id: space.id, name: space.name }, folder: { id: folder.id, name: folder.name } }))),
    ...space.folderlessLists
      .filter((list) => OPERATIONAL_LIST_PATTERN.test(list.name))
      .map((list) => ({ ...list, space: { id: space.id, name: space.name }, folder: null }))
  ]);
}

function printOperationalLists(matches: OperationalMatch[]): void {
  console.log('\n====================================');
  console.log('POSSIBLE AMI / NOTIFICATION LISTS');
  console.log('====================================');
  if (!matches.length) {
    console.log('\nNo matching Lists found.');
    return;
  }
  for (const match of matches) {
    console.log(`\nSpace: ${match.space.name} (${match.space.id})`);
    console.log(`Client/Folder: ${match.folder ? `${match.folder.name} (${match.folder.id})` : '(folderless)'}`);
    console.log(`List: ${match.name}`);
    console.log(`List ID: ${match.id}`);
  }
}

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  if (!process.env.CLICKUP_API_TOKEN?.trim()) throw new Error('CLICKUP_API_TOKEN is not configured');
  const workspaceId = requireWorkspaceId();

  const { teams } = await getTeams();
  console.log('✓ ClickUp authentication successful');
  const workspace = teams.find((team) => String(team.id) === workspaceId);
  if (!workspace) throw new Error(`Workspace ${workspaceId} is not accessible with the configured ClickUp token`);
  console.log(`✓ Workspace found: ${workspace.name}`);
  console.log(`✓ Workspace ID: ${workspace.id}`);

  const { spaces: apiSpaces } = await getSpaces(workspaceId);
  const spaces: DiscoveredSpace[] = [];
  for (const space of apiSpaces) {
    const [{ folders }, { lists: folderlessLists }] = await Promise.all([
      getFolders(String(space.id)),
      getFolderlessLists(String(space.id))
    ]);
    spaces.push({
      id: String(space.id),
      name: space.name,
      folders: folders.map((folder) => ({
        id: String(folder.id),
        name: folder.name,
        lists: (folder.lists ?? []).map((list) => ({ id: String(list.id), name: list.name }))
      })),
      folderlessLists: folderlessLists.map((list) => ({ id: String(list.id), name: list.name }))
    });
  }

  printHierarchy(spaces);
  const operationalLists = findOperationalLists(spaces);
  printOperationalLists(operationalLists);

  console.log('\n====================================');
  console.log('KNOWN LIST SANITY CHECK');
  console.log('====================================');
  const knownList = await getList(KNOWN_LIST_ID);
  const knownListLocation = spaces.flatMap((space) => [
    ...space.folders.flatMap((folder) => folder.lists.map((list) => ({ list, space, folder }))),
    ...space.folderlessLists.map((list) => ({ list, space, folder: null }))
  ]).find(({ list }) => list.id === KNOWN_LIST_ID);
  if (!knownListLocation) throw new Error(`Known List ${KNOWN_LIST_ID} was not found in configured Workspace ${workspaceId}`);
  if (knownList.space?.id && String(knownList.space.id) !== knownListLocation.space.id) {
    throw new Error(`Known List ${KNOWN_LIST_ID} returned an unexpected parent Space`);
  }
  console.log(`\nList name: ${knownList.name}`);
  console.log(`List ID: ${knownList.id}`);
  console.log(`Parent Folder: ${knownList.folder?.name ?? '(folderless or unavailable)'}${knownList.folder?.id ? ` (${knownList.folder.id})` : ''}`);
  console.log(`Parent Space: ${knownList.space?.name ?? '(unavailable)'}${knownList.space?.id ? ` (${knownList.space.id})` : ''}`);

  const output = {
    discoveredAt: new Date().toISOString(),
    workspace: { id: String(workspace.id), name: workspace.name },
    spaces,
    operationalLists,
    knownList: {
      id: String(knownList.id), name: knownList.name,
      folder: knownList.folder ? { id: String(knownList.folder.id), name: knownList.folder.name } : null,
      space: knownList.space ? { id: String(knownList.space.id), name: knownList.space.name } : null
    }
  };
  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(`\n✓ Discovery metadata saved to ${path.relative(process.cwd(), OUTPUT_PATH)}`);
}

function reportError(error: unknown): void {
  if (error instanceof ClickUpApiError) {
    if (error.status === 401) console.error(`✗ ClickUp authentication failed (HTTP 401): ${error.message}`);
    else if (error.status === 429) console.error(`✗ ClickUp rate limit reached (HTTP 429): ${error.message}.${error.retryAfter ? ` Retry after ${error.retryAfter} seconds.` : ''}`);
    else console.error(`✗ ClickUp API request failed (HTTP ${error.status})${error.code ? ` [${error.code}]` : ''}: ${error.message}`);
    return;
  }
  console.error(`✗ ${error instanceof Error ? error.message : 'Unexpected discovery failure'}`);
}

main().catch((error) => {
  reportError(error);
  process.exitCode = 1;
});
