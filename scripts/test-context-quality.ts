import assert from 'node:assert/strict';
import { rawEvidence } from '../lib/intelligence/context';

const raw = {
  custom_fields: [
    { name: 'Channel', type: 'drop_down', value: null },
    { name: 'Dropbox Project Path', type: 'text', value: '' },
    { name: 'Hourly Rate', type: 'number', value: 0 },
    { name: 'Approved', type: 'checkbox', value: false },
    { name: 'Activity Type', type: 'text', value: 'Development' },
    { name: 'Empty Labels', type: 'labels', value: [] },
    { name: 'Empty Object', type: 'json', value: {} }
  ],
  attachments: [{ id: 'attachment-1', title: 'Project Sheet' }]
};
const { lines, coverage } = rawEvidence(raw);
const output = lines.join('\n');
assert.equal(coverage.customFields, 7, 'Raw evidence coverage must retain all custom fields');
assert.equal(coverage.attachments, 1, 'Attachment metadata coverage must remain intact');
assert.match(output, /Hourly Rate.*0/);
assert.match(output, /Approved.*false/);
assert.match(output, /Activity Type.*Development/);
assert.match(output, /4 unset\/empty custom field entries omitted/);
assert.doesNotMatch(output, /Channel \(/);
assert.doesNotMatch(output, /Dropbox Project Path \(/);
assert.doesNotMatch(output, /Empty Labels \(/);
assert.match(output, /Project Sheet/);
console.log('Context quality tests passed: empty fields omitted, zero/false preserved, attachment coverage unchanged.');
