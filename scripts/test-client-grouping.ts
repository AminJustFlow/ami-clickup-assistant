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
console.log('Client grouping tests passed: invoicing, budgets, multiple codes, ambiguous names and duplicate codes.');
