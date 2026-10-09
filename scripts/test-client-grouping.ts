import assert from 'node:assert/strict';
import { groupClientFolders, needsClientAttribution } from '../lib/clients/grouping';

const names = [
  'Fimbel Garage Doors (FMB)', 'FMB Invoiced Projects', 'FMB NO GO Projects',
  'IBEW Local 1837 (1837)', '1837 Invoicing',
  'Just Flow', 'JF Invoiced Projects',
  'Woodstone Homes (WSH) (SCG)', 'WSH Invoiced Projects',
  'BrightLeaf (BRL) (PCS)', 'BRL Invoiced Projects',
  'Socha Companies (SOC)', 'SOC Monthly Budget', 'SOC Invoiced Projects',
  'Invoiced Projects', 'Invoiced Projects', 'Other Client (FMB)'
];
const clients = names.map((name, index) => ({ id: index + 1, slug: 'test-' + index, name }));
const groups = groupClientFolders(clients);
function members(name: string): string[] {
  const group = groups.find(group => group.canonical.name === name);
  assert.ok(group, 'Missing group: ' + name);
  return group.folders.map(folder => folder.name);
}
assert.deepEqual(members('IBEW Local 1837 (1837)'), ['IBEW Local 1837 (1837)', '1837 Invoicing']);
assert.deepEqual(members('Just Flow'), ['Just Flow', 'JF Invoiced Projects']);
assert.deepEqual(members('Woodstone Homes (WSH) (SCG)'), ['Woodstone Homes (WSH) (SCG)', 'WSH Invoiced Projects']);
assert.deepEqual(members('BrightLeaf (BRL) (PCS)'), ['BrightLeaf (BRL) (PCS)', 'BRL Invoiced Projects']);
assert.deepEqual(members('Socha Companies (SOC)'), ['Socha Companies (SOC)', 'SOC Invoiced Projects', 'SOC Monthly Budget']);
assert.deepEqual(members('Fimbel Garage Doors (FMB)'), ['Fimbel Garage Doors (FMB)']);
assert.equal(groups.filter(group => group.canonical.name === 'Invoiced Projects').length, 2);
assert.equal(needsClientAttribution('Invoiced Projects'), true);

// Regression: same-name invoicing folders must be mapped only by verified ClickUp ID.
const verified = [
  ['Maynard PTO (MPT)', '90149427330'], ['IBEW Local 2320 (IBE)', '90146979793'],
  ['900 Degrees (900)', '90146979782'], ['Castle in the Clouds (CIC)', '90146979788'],
  ['Red Arrow Diner, Etc. (RAD)', '90146753212'],
  ['Invoiced Projects', '90149466751'], ['Invoiced Projects', '90148194796'],
  ['Invoiced Projects', '90148170982'], ['Invoiced Projects', '90148149268'],
  ['Invoiced Projects', '90147831069'], ['Invoiced Projects', '99999999999']
].map(([name, clickupFolderId], i) => ({ id: i + 100, name, clickupFolderId, slug: 'verified-' + i }));
const verifiedGroups = groupClientFolders(verified);
for (const [canonical, folderId] of [
  ['Maynard PTO (MPT)', '90149466751'], ['IBEW Local 2320 (IBE)', '90148194796'],
  ['900 Degrees (900)', '90148170982'], ['Castle in the Clouds (CIC)', '90148149268'],
  ['Red Arrow Diner, Etc. (RAD)', '90147831069']
]) {
  const group = verifiedGroups.find(group => group.canonical.name === canonical);
  assert.ok(group, canonical + ' not found');
  assert.ok(group.folders.some(folder => folder.clickupFolderId === folderId), folderId + ' not grouped with ' + canonical);
}
assert.equal(verifiedGroups.filter(group => group.canonical.name === 'Invoiced Projects').length, 1, 'Unknown generic folder must remain separate');
console.log('Client grouping tests passed: invoicing, budgets, multiple codes, ambiguous names and duplicate codes.');
