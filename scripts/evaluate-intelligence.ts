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
    name: 'Ami mention without request',
    context: base('Calendar Sync', 'Hi @Ami D\'Amelio, I reached out to FluentBooking Support and will update you once I hear back.'),
    expected: { state: 'WAITING_ON_VENDOR', needsAmi: false, waitingOnType: 'VENDOR' }
  },
  {
    name: 'Later completion clears old Ami request',
    context: {
      ...base('Website Fix', '@Ami D\'Amelio can you please confirm this approach?'),
      comments: [
        { id: 1, authorName: 'Amin', body: '@Ami D\'Amelio can you please confirm this approach?', createdAt: new Date('2026-10-07T10:00:00Z') },
        { id: 2, authorName: 'Amin', body: 'This is all set and published now.', createdAt: new Date('2026-10-07T12:00:00Z') }
      ]
    },
    expected: { state: 'COMPLETED', needsAmi: false, waitingOnType: 'NONE' }
  },
  {
    name: 'Internal team instruction is not client waiting',
    context: base('Magical Tour', 'Hi @Matt MacDonald @Amin Hcinet @Monica Murray Derr @Rayanne Pruitt - Please record your time and upload your assets. Does 11:35am-1:40pm sound right?'),
    expected: { state: 'ACTIVE', needsAmi: false, waitingOnType: 'NONE' }
  },
  {
    name: 'Ami authored request to teammate is not Needs Ami',
    context: {
      ...base('Proposal', 'placeholder'),
      comments: [{ id: 1, authorName: "Ami D'Amelio", body: '@Rayanne Pruitt can you please start the proposal shell for this client?', createdAt: new Date('2026-10-07T12:00:00Z') }]
    },
    expected: { state: 'ACTIVE', needsAmi: false, waitingOnType: 'NONE' }
  },
  {
    name: 'Vendor name alone does not define dependency',
    context: base('Bus Dev', 'Please include Meta Ads and website development in the estimate. We are still waiting on credentials for Engrain integration options.'),
    expected: { state: 'WAITING_ON_VENDOR', needsAmi: false, waitingOnType: 'VENDOR' }
  },
  {
    name: 'Sent recommendation to client is not generic blocked',
    context: base('Domain Registration', 'Sent recommendations to CAP for how to use vanity domains.'),
    expected: { state: 'ACTIVE', needsAmi: false, waitingOnType: 'NONE' }
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
