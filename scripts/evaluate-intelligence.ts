import { analyzeWithRules } from '../lib/intelligence/engine';
import type { TaskContext } from '../lib/intelligence/context';

type Case = {
  name: string;
  context: TaskContext;
  expected: { state: string; needsAmi: boolean; waitingOnType: string };
};

const base = (name: string, body: string): TaskContext => ({
  taskId: 1,
  clickupTaskId: 'fixture',
  name,
  description: null,
  status: 'in progress',
  priority: null,
  dueDate: null,
  updatedAt: new Date('2026-10-07T12:00:00Z'),
  listName: 'VTH Website',
  assignees: ['Amin'],
  comments: [{ id: 1, authorName: 'Amin', body, createdAt: new Date('2026-10-07T12:00:00Z') }]
});

const cases: Case[] = [
  {
    name: 'FluentBooking support escalation',
    context: base('Individual Booking Calendars Setup', 'Hi @Ami D\'Amelio, FluentBooking is still asking for consent. I reached out to FluentBooking Support for further guidance and will post any updates here once I hear back.'),
    expected: { state: 'WAITING_ON_VENDOR', needsAmi: false, waitingOnType: 'VENDOR' }
  },
  {
    name: 'Popup published',
    context: base('Discount Pop-Up', 'The popup is published. You can see it once you scroll about 50% down the website.'),
    expected: { state: 'COMPLETED', needsAmi: false, waitingOnType: 'NONE' }
  },
  {
    name: 'Spectrum handoff after approval',
    context: base('Leasing Sign', 'After much back and forth, the sign is approved. I\'ve sent this one to Spectrum.'),
    expected: { state: 'WAITING_ON_VENDOR', needsAmi: false, waitingOnType: 'VENDOR' }
  },
  {
    name: 'Direct Ami request',
    context: base('Post-Launch Fixes', '@Ami D\'Amelio can you please review this and confirm which option you want?'),
    expected: { state: 'WAITING_ON_AMI', needsAmi: true, waitingOnType: 'AMI' }
  },
  {
    name: 'Client review',
    context: base('Social Media Management CAP', 'October posts were sent to the client for review.'),
    expected: { state: 'WAITING_ON_CLIENT', needsAmi: false, waitingOnType: 'CLIENT' }
  }
];

let passed = 0;
for (const test of cases) {
  const actual = analyzeWithRules(test.context, new Date('2026-10-07T13:00:00Z'));
  const ok = actual.agentState === test.expected.state &&
    actual.needsAmi === test.expected.needsAmi &&
    actual.waitingOnType === test.expected.waitingOnType;
  if (ok) passed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${test.name}`);
  if (!ok) console.log('  expected', test.expected, 'actual', {
    state: actual.agentState,
    needsAmi: actual.needsAmi,
    waitingOnType: actual.waitingOnType
  });
}

console.log(`\n${passed}/${cases.length} evaluation cases passed.`);
if (passed !== cases.length) process.exitCode = 1;
