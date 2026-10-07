# Ami ClickUp Intelligence Assistant

## Detailed Architecture and Implementation Plan

**Purpose:** Build an internal AI-powered operations assistant that sits
on top of ClickUp and helps Ami understand what is happening across
clients and employees without having to process a large volume of raw
ClickUp notifications.

The system is not intended to be another ClickUp notification feed. It
should understand ClickUp activity, infer the real operational state
from comments and context, identify what requires Ami's attention,
summarize meaningful changes, expose details on demand, and allow Ami to
ask natural-language questions about agency activity.

------------------------------------------------------------------------

# 1. Product Goal

The assistant should answer five core questions:

1.  What is happening with each client?
2.  What is each employee working on?
3.  What actually needs Ami's attention?
4.  What changed since Ami last checked?
5.  What might be getting missed or falling through the cracks?

The primary navigation should be:

``` text
CLIENTS
   ↓
Client
   ↓
Ami List / Notifications List
   ↓
Task
   ↓
Comments / Timeline


EMPLOYEES
   ↓
Employee
   ↓
Today / Yesterday / Week
   ↓
Clients
   ↓
Activity
```

Cross-cutting intelligence views:

``` text
Needs Ami
Waiting On
Important
Potential Problems
Since Last Visit
Ask Assistant
```

------------------------------------------------------------------------

# 2. Core Design Principle

ClickUp status is not the operational truth for this team.

The team commonly uses statuses such as:

``` text
Todo
In Progress
Done
```

However, people frequently communicate the actual state through
comments.

Example:

``` text
ClickUp Status:
In Progress

Latest Comment:
"All set, this is live now."

Operational State:
Completed
```

Another example:

``` text
ClickUp Status:
In Progress

Latest Comment:
"I reached out to FluentBooking support. Waiting to hear back."

Operational State:
Waiting on Vendor

Waiting On:
FluentBooking
```

Therefore, the assistant must maintain a separate inferred **Agent
State**.

Signal hierarchy:

``` text
1. Recent comments / conversation context
2. Client and List
3. Ami List placement
4. Explicit requests or mentions of Ami
5. Priority
6. Due date
7. Assignee
8. Recency of activity
9. ClickUp status
```

ClickUp status remains useful metadata, but comments and context are
stronger evidence of what is actually happening.

------------------------------------------------------------------------

# 3. Agent State Model

Use a controlled enum:

``` text
NOT_STARTED
ACTIVE
COMPLETED
WAITING_ON_AMI
WAITING_ON_TEAM
WAITING_ON_CLIENT
WAITING_ON_VENDOR
NEEDS_REVIEW
BLOCKED
ISSUE
UNKNOWN
```

Keep this list relatively small so classifications remain consistent.

## Needs Ami

`needs_ami` must be separate from operational state.

``` text
needs_ami: true | false
ami_action: string | null
```

Examples:

``` text
State:
WAITING_ON_CLIENT

Needs Ami:
false
```

``` text
State:
ACTIVE

Needs Ami:
true

Ami Action:
Approve the campaign budget.
```

An item can be important without requiring Ami.

## Waiting On

Store:

``` text
waiting_on_type
waiting_on_name
```

Types:

``` text
NONE
AMI
TEAM
CLIENT
VENDOR
OTHER
```

Example:

``` text
State:
WAITING_ON_VENDOR

Waiting On Type:
VENDOR

Waiting On Name:
FluentBooking
```

------------------------------------------------------------------------

# 4. High-Level Architecture

``` text
                           CLICKUP
                              │
                   ┌──────────┴──────────┐
                   │                     │
               WEBHOOKS           RECONCILIATION
                   │                     │
                   └──────────┬──────────┘
                              ↓
                        API ENDPOINT
                              │
                        Verify HMAC
                              │
                              ↓
                         EVENT QUEUE
                              │
                              ↓
                           WORKER
                              │
               ┌──────────────┴───────────────┐
               │                              │
          CLICKUP API                    POSTGRESQL
               │                              │
               └──────────────┬───────────────┘
                              ↓
                       CONTEXT BUILDER
                              │
                ┌─────────────┴──────────────┐
                │                            │
           RULE ENGINE                    OPENAI
                │                     Structured Output
                │                            │
                └─────────────┬──────────────┘
                              ↓
                         STATE ENGINE
                              │
                              ↓
                    INTELLIGENCE STORE
                              │
          ┌───────────────────┼────────────────────┐
          │                   │                    │
       CLIENTS            EMPLOYEES            NEEDS AMI
          │                   │                    │
          └───────────────────┼────────────────────┘
                              ↓
                       NEXT.JS PORTAL
                              │
       ┌──────────────────────┼──────────────────────┐
       │                      │                      │
     HOME                  DETAILS                ASK AI
       │                      │                      │
       └──────────────────────┴──────────────────────┘
                              │
                              ↓
                         POSTGRESQL
```

------------------------------------------------------------------------

# 5. Recommended Technology Stack

``` text
Frontend:
Next.js
TypeScript

Backend:
Next.js server/API routes or dedicated Node.js service

Database:
PostgreSQL

ORM:
Prisma

Queue:
AWS SQS
or Redis + BullMQ

AI:
OpenAI Responses API

Hosting:
AWS

Authentication:
Microsoft/company SSO

Real-time UI:
Server-Sent Events or WebSockets
```

Suggested project structure:

``` text
ami-assistant/
│
├── app/
│   ├── dashboard/
│   ├── clients/
│   ├── employees/
│   ├── waiting/
│   ├── assistant/
│   ├── admin/
│   └── api/
│
├── lib/
│   ├── clickup/
│   ├── openai/
│   ├── intelligence/
│   ├── scoring/
│   ├── context/
│   └── db/
│
├── workers/
│   ├── clickup-events.ts
│   ├── intelligence.ts
│   └── reconciliation.ts
│
├── prisma/
│   └── schema.prisma
│
├── tests/
│   ├── fixtures/
│   ├── intelligence/
│   └── integration/
│
└── scripts/
    ├── clickup-discovery.ts
    ├── initial-sync.ts
    └── run-evals.ts
```

------------------------------------------------------------------------

# 6. Environment Variables

Example:

``` text
DATABASE_URL=

CLICKUP_API_TOKEN=
CLICKUP_WORKSPACE_ID=
CLICKUP_WEBHOOK_SECRET=

OPENAI_API_KEY=

APP_URL=
```

Never expose ClickUp or OpenAI credentials to the browser.

Flow:

``` text
Browser
   ↓
Your Backend
   ↓
ClickUp / OpenAI
```

Not:

``` text
Browser → ClickUp secret token
Browser → OpenAI API key
```

------------------------------------------------------------------------

# 7. ClickUp Discovery Phase

Before AI work, understand the actual ClickUp hierarchy.

Retrieve:

``` text
Workspace
   ↓
Spaces
   ↓
Folders
   ↓
Lists
   ↓
Tasks
```

For each client identify:

``` text
Client
ClickUp Folder
All active List IDs
```

The current mapping rule is deterministic:

``` text
Client = ClickUp Folder
Client work streams = all Lists in that Folder
```

Needs Ami, waiting, importance, and operational state are intelligence dimensions and must not be inferred from List names.

Create a discovery script that prints all relevant Spaces, Folders,
Lists, IDs, and names.

Do not make AI infer client/List relationships if the relationship is
deterministic.

------------------------------------------------------------------------

# 8. Database Design

## 8.1 Clients

``` text
clients

id
name
slug
active
created_at
updated_at
```

Example:

``` text
1 | VOTH
2 | Studley's
3 | Fimbel
4 | IBEW
5 | LHC
```

## 8.2 ClickUp Lists

``` text
clickup_lists

id
clickup_list_id
client_id
name
type
active
```

`type` is optional legacy metadata. Current client Lists are treated generically:

``` text
AMI
NOTIFICATION
OTHER
```

The persisted ClickUp Folder and Space IDs define the client relationship.

## 8.3 Employees

``` text
employees

id
clickup_user_id
name
email
active
```

Use ClickUp user IDs, not names alone.

## 8.4 Tasks

``` text
tasks

id
clickup_task_id
client_id
list_id
name
description
clickup_status
clickup_priority
due_date
created_at
updated_at
clickup_created_at
clickup_updated_at
clickup_url
deleted
```

Keep `clickup_status` separate from `agent_state`.

## 8.5 Task Assignees

Because tasks can have multiple assignees:

``` text
task_assignees

task_id
employee_id
```

## 8.6 Comments

Comments are a first-class source of intelligence.

``` text
comments

id
clickup_comment_id
task_id
author_clickup_id
author_name
body
created_at
updated_at
```

Always preserve the original comment.

## 8.7 Task Events

``` text
task_events

id
clickup_event_id
task_id
event_type
actor_id
actor_name
before_value
after_value
occurred_at
raw_payload
```

Possible event types:

``` text
TASK_CREATED
TASK_UPDATED
TASK_COMMENT_POSTED
TASK_COMMENT_UPDATED
TASK_PRIORITY_UPDATED
TASK_ASSIGNEE_UPDATED
TASK_STATUS_UPDATED
TASK_DUE_DATE_UPDATED
TASK_MOVED
```

## 8.8 Task Intelligence

``` text
task_intelligence

task_id
agent_state
headline
current_summary
needs_ami
ami_action
waiting_on_type
waiting_on_name
importance_score
ami_attention_score
risk_level
last_meaningful_change
last_meaningful_change_at
confidence
analyzed_at
```

This table powers the UI.

## 8.9 Meaningful Events

``` text
meaningful_events

id
task_id
client_id
type
headline
summary
importance
needs_ami
occurred_at
```

Types:

``` text
COMPLETED
NEW_ISSUE
BLOCKED
UNBLOCKED
WAITING_CHANGED
NEEDS_AMI
AMI_RESOLVED
CLIENT_RESPONSE
DEADLINE_RISK
PRIORITY_CHANGE
SIGNIFICANT_PROGRESS
```

## 8.10 AI Runs

For auditing:

``` text
intelligence_runs

id
task_id
model
prompt_version
input_hash
input
output
created_at
duration_ms
```

## 8.11 Feedback

``` text
intelligence_feedback

id
task_id
user_id
rating
reason
notes
created_at
```

## 8.12 User Activity

``` text
user_activity

user_id
last_dashboard_seen_at
```

Used for "Since Last Visit."

------------------------------------------------------------------------

# 9. Raw Data vs Intelligence

Keep these layers strictly separate.

``` text
RAW DATA
────────
ClickUp Task
Comments
Priority
Assignee
Due Date
List
Events

        ↓

INTELLIGENCE
────────────
Current Situation
Operational State
Needs Ami
Waiting On
Importance
Risk
Meaningful Change
```

If the model makes a mistake, intelligence can be regenerated without
corrupting source data.

------------------------------------------------------------------------

# 10. Initial ClickUp Import

Before webhooks, build an initial sync script.

Example command:

``` text
npm run clickup:sync
```

Process:

``` text
1. Read configured Lists
2. Retrieve tasks
3. Upsert tasks
4. Retrieve task comments
5. Upsert comments
6. Retrieve assignees
7. Store relationships
8. Log totals
```

Expected output:

``` text
Clients: 24
Lists: 48
Tasks: 1,237
Comments: 8,921
Employees: 14

Sync completed.
```

Start with **one client**, ideally VOTH.

------------------------------------------------------------------------

# 11. Raw Debug Page

Before AI, create:

``` text
/debug/tasks
```

or:

``` text
/debug/voth
```

Display:

``` text
Client
List
Task
ClickUp Status
Priority
Assignees
Due Date
Comments
Last Activity
ClickUp Link
```

Take 20 known tasks and manually compare the page to ClickUp.

Do not proceed until the mirror is accurate.

------------------------------------------------------------------------

# 12. Webhook Architecture

Create:

``` text
POST /api/webhooks/clickup
```

Listen for relevant activity:

``` text
Task created
Task updated
Comment posted
Comment updated
Priority changed
Assignee changed
Due date changed
Task moved
Status changed
Task completed
```

A webhook means:

> Something changed. Reevaluate this task.

It does **not** mean:

> Notify Ami.

------------------------------------------------------------------------

# 13. Webhook Security

Verify ClickUp webhook signatures.

Process:

``` text
Receive raw request body
        ↓
Calculate HMAC with webhook secret
        ↓
Compare against X-Signature
        ↓
Valid?
  YES → continue
  NO  → reject
```

Never process unverified webhook requests.

------------------------------------------------------------------------

# 14. Idempotency

Webhook delivery can be duplicated.

Create:

``` text
processed_webhook_events

event_key
processed_at
```

Before processing:

``` text
Does event key already exist?

YES → ignore
NO  → process
```

This prevents duplicate intelligence and notifications.

------------------------------------------------------------------------

# 15. Queue Architecture

The webhook endpoint should be lightweight:

``` text
ClickUp
   ↓
Webhook endpoint
   ↓
Verify
   ↓
Store raw event
   ↓
Queue job
   ↓
Return success
```

Do not call OpenAI directly from the webhook request.

Recommended AWS flow:

``` text
ClickUp
   ↓
Webhook
   ↓
SQS
   ↓
Worker
```

Example job:

``` json
{
  "type": "CLICKUP_TASK_CHANGED",
  "taskId": "abc123",
  "event": "taskCommentPosted",
  "receivedAt": "..."
}
```

------------------------------------------------------------------------

# 16. Debouncing

One human action can generate multiple ClickUp events.

Example:

``` text
Comment added
Description changed
Attachment uploaded
Status changed
```

Do not run four AI analyses.

Store:

``` text
task_pending_analysis

task_id
last_event_at
```

Wait approximately:

``` text
30 to 60 seconds after latest activity
```

Then process the final state once.

For lower urgency events, 1 to 2 minutes may be acceptable.

------------------------------------------------------------------------

# 17. Task Refresh

When processing a queued task:

``` text
Task changed
    ↓
Fetch latest task from ClickUp
    ↓
Fetch recent comments
    ↓
Update raw database
    ↓
Build intelligence context
```

Do not rely exclusively on webhook payloads.

------------------------------------------------------------------------

# 18. Context Builder

Create:

``` text
buildTaskContext(taskId)
```

Example output:

``` json
{
  "client": {
    "name": "VOTH"
  },
  "list": {
    "name": "VOTH Notifications",
    "type": "NOTIFICATION"
  },
  "task": {
    "name": "Outlook Calendar Integration",
    "description": "...",
    "clickup_status": "in progress",
    "priority": "high",
    "due_date": "...",
    "assignees": ["Amin"]
  },
  "previous_intelligence": {
    "state": "WAITING_ON_VENDOR",
    "waiting_on": "Eaglenet",
    "summary": "..."
  },
  "recent_comments": [
    "...",
    "...",
    "..."
  ],
  "new_events": []
}
```

Do not send hundreds of old comments every time.

Start with:

``` text
Task description
Current metadata
Previous intelligence
Last 5-10 meaningful comments
New comments since previous analysis
New events
```

Retrieve older history only if necessary.

------------------------------------------------------------------------

# 19. AI Task Analyzer

The model's job is not simply to summarize.

It must answer:

``` text
What changed?
What is the current situation?
Is this actually completed?
Who owns it?
Who are we waiting on?
Does Ami need to do anything?
Is something wrong?
How important is this?
```

Use strict structured output.

Suggested schema:

``` text
meaningful_change: boolean

agent_state:
  NOT_STARTED
  ACTIVE
  COMPLETED
  WAITING_ON_AMI
  WAITING_ON_TEAM
  WAITING_ON_CLIENT
  WAITING_ON_VENDOR
  NEEDS_REVIEW
  BLOCKED
  ISSUE
  UNKNOWN

headline: string

current_summary: string

needs_ami: boolean

ami_action: string | null

waiting_on_type:
  NONE
  AMI
  TEAM
  CLIENT
  VENDOR
  OTHER

waiting_on_name: string | null

risk:
  LOW
  MEDIUM
  HIGH
  CRITICAL

importance:
  integer 0-100

confidence:
  number 0-1

last_meaningful_change: string
```

------------------------------------------------------------------------

# 20. AI Prompt Philosophy

The system instructions should explicitly reflect the agency workflow.

Concept:

``` text
You analyze ClickUp activity for an agency operations manager.

ClickUp status is not necessarily the true operational state.

Employees frequently communicate completion, blockers,
requests, approvals and waiting states through comments.

Infer the current operational state from the complete supplied
context.

Statements such as "all set", "live", "published", "fixed",
or equivalent may indicate completion even when ClickUp
remains In Progress.

Statements such as "reached out", "waiting to hear back",
or equivalent may indicate a waiting state.

Determine whether Ami personally needs to take an action.

Do not set needs_ami=true merely because something is
important.

Distinguish importance from Ami action.

Never invent actions, people, deadlines, blockers or outcomes
not supported by the supplied context.
```

------------------------------------------------------------------------

# 21. Example AI Interpretation

Input:

``` text
ClickUp Status:
In Progress

Previous Situation:
Waiting on Eaglenet

Comments:

Jacob:
Permissions are approved.

Amin:
Still receiving the consent screen.

Amin:
Reached out to FluentBooking support.
```

Expected output:

``` text
Agent State:
WAITING_ON_VENDOR

Current Waiting On:
FluentBooking

Previous Blocker:
Eaglenet

Previous Blocker Resolved:
Yes

Completed:
No

Needs Ami:
No

Headline:
VOTH calendar integration remains blocked

Meaningful Change:
Blocker shifted from Eaglenet to FluentBooking.
```

------------------------------------------------------------------------

# 22. Deterministic Rule Engine

AI should not control all prioritization.

Example base rules:

``` text
Urgent priority              +25
High priority                +15
Overdue                      +20
Due within 24 hours          +15
Ami List                     +25
Explicit Ami mention         +20
Recent client response       +10
Blocked                      +15
No activity for 3+ days      +10
```

Then combine with model analysis.

Example:

``` text
rules_score = 60
ai_importance = 75
```

Possible weighted formula:

``` text
final_importance =
(0.6 × rules_score)
+
(0.4 × ai_importance)
```

Tune this from real usage.

------------------------------------------------------------------------

# 23. Two Separate Scores

Maintain:

``` text
importance_score
ami_attention_score
```

Example:

``` text
Production Website Down

Importance:
100

Ami Attention:
40
```

Amin may already be handling it.

Another example:

``` text
Campaign Budget Approval

Importance:
50

Ami Attention:
95
```

Ami needs to act even though it is not an emergency.

This distinction is critical.

------------------------------------------------------------------------

# 24. State Engine

Compare previous intelligence to new intelligence.

``` text
Previous Interpretation
          +
New Activity
          ↓
Current Interpretation
```

Example:

``` text
Previous:
WAITING_ON_VENDOR
Waiting on Eaglenet

New:
WAITING_ON_VENDOR
Waiting on FluentBooking
```

Meaningful event:

``` text
Blocker shifted from Eaglenet to FluentBooking.
```

Other meaningful transitions:

``` text
ACTIVE → COMPLETED

needs_ami false → true

BLOCKED → ACTIVE

WAITING_ON_CLIENT → ACTIVE

risk MEDIUM → HIGH
```

------------------------------------------------------------------------

# 25. Client Intelligence

Create:

``` text
generateClientIntelligence(clientId)
```

Retrieve:

``` text
Active task intelligence
Meaningful events
Needs Ami items
Waiting items
High importance items
Recent completions
Recent client responses
```

Generate/store:

``` text
client_health
client_summary
primary_issue
needs_ami_count
blocked_count
waiting_count
last_meaningful_activity
```

## Client Health

Prefer deterministic health rules.

Example:

``` text
CRITICAL
Any critical unresolved issue

ATTENTION
High-risk unresolved issue
or multiple blockers

WATCHING
Meaningful waiting/deadline situation

HEALTHY
Nothing significant detected
```

AI can explain the health state, but should not randomly choose it on
each page load.

------------------------------------------------------------------------

# 26. Employee Intelligence

Create:

``` text
getEmployeeActivity(employeeId, range)
```

Include tasks where the employee is:

``` text
Assignee
Comment author
Meaningful updater
```

Calculate:

``` text
Completed
Active
Waiting
Blocked
Needs Ami
Clients touched
Meaningful updates
```

Do not treat every tiny ClickUp edit as equal productivity.

Example narrative:

``` text
Amin worked primarily across VOTH, Fimbel and Studley's
today. He completed four website/tracking items and continued
troubleshooting VOTH's calendar integration. Two items are
currently waiting on external vendors.
```

Always show the underlying items so Ami can inspect them.

------------------------------------------------------------------------

# 27. Main Dashboard

Suggested layout:

``` text
┌──────────────────────────────────────────────┐
│ AMI ASSISTANT                               │
│                                              │
│ Wednesday, October 7                         │
│                                              │
│ 🔴 3 Need You      ⚠ 5 Important            │
│                                              │
│ CLIENTS       EMPLOYEES                      │
├──────────────────────────────────────────────┤
│ NEEDS YOUR ATTENTION                         │
│                                              │
│ Studley's                                    │
│ Waiting for your direction on wedding photos │
│ [View]                                       │
│                                              │
│ Fimbel                                       │
│ Verification deadline requires owner action  │
│ [View]                                       │
├──────────────────────────────────────────────┤
│ SINCE YOU LAST CHECKED                       │
│                                              │
│ 7 meaningful updates                         │
│ 4 completed                                  │
│ 1 new blocker                                │
│ 2 client responses                           │
├──────────────────────────────────────────────┤
│ IMPORTANT CLIENTS                            │
│                                              │
│ VOTH          ⚠ Attention                    │
│ Fimbel        ⚠ Attention                    │
│ Studley's     ● Active                       │
├──────────────────────────────────────────────┤
│ WAITING ON                                   │
│ Ami 5 | Clients 4 | Vendors 3 | Team 2      │
├──────────────────────────────────────────────┤
│ Ask anything...                              │
└──────────────────────────────────────────────┘
```

Avoid excessive charts initially.

The management problem is understanding context and action, not visual
analytics.

------------------------------------------------------------------------

# 28. Progressive Disclosure

Every important card should have three levels.

## Level 1: Glance

``` text
⚠ VOTH calendar connection remains blocked
Waiting on FluentBooking.
```

## Level 2: Click

``` text
WHAT'S HAPPENING

Eaglenet approved the requested permissions,
but FluentBooking is still requesting admin consent.

Owner:
Amin

Waiting On:
FluentBooking

Ami Action:
None

Last Meaningful Update:
22 minutes ago

[View Timeline]
[Open ClickUp]
```

## Level 3: Timeline

``` text
TODAY

2:12 PM
Amin contacted FluentBooking support.

11:34 AM
Jacob confirmed permissions were granted.

10:52 AM
Connection test still returned admin consent.

YESTERDAY

4:13 PM
Erika reported the Outlook calendar was not connected.
```

This keeps notifications concise without losing detail.

------------------------------------------------------------------------

# 29. Clients Page

Route:

``` text
/clients
```

Example:

``` text
CLIENTS

Search...

VOTH
⚠ Attention
1 blocked
0 needs Ami
Last meaningful update 22m ago

Fimbel
⚠ Attention
1 needs Ami
Last meaningful update 1h ago

Studley's
● Active
1 needs Ami
5 updates today

IBEW
✓ Healthy
3 updates today
```

Filters:

``` text
All
Needs Ami
Attention
Waiting
Healthy
```

------------------------------------------------------------------------

# 30. Client Detail

Route:

``` text
/clients/[clientId]
```

Sections:

``` text
Overview
Needs Attention
Ami List
Notifications
Waiting On
Recently Completed
Activity
Ask About Client
```

Example:

``` text
VILLAGE ON TECHNOLOGY HILL

⚠ ATTENTION

Current Situation:
The Outlook calendar integration remains blocked.
Eaglenet confirmed permissions, but FluentBooking
continues requesting admin consent.

Owner:
Amin

Waiting On:
FluentBooking

Ami Action:
None
```

Then expose the Lists:

``` text
Ami List            2
Notifications       6
```

------------------------------------------------------------------------

# 31. Notifications List

The Notifications List should show interpreted activity, not raw ClickUp
events.

Example:

``` text
VOTH > Notifications

TODAY

Website updates completed
✓ Completed

Individual booking pages created
✓ Completed

Outlook calendar connection
⚠ Waiting on FluentBooking

Rent Manager guest card
✓ Fixed
```

Do not show:

``` text
Amin commented
Amin changed status
Amin attached file
```

unless Ami drills into the task timeline.

------------------------------------------------------------------------

# 32. Ami List

The Ami List should be action-oriented.

Example:

``` text
VOTH > Ami

NEEDS AMI

Nothing currently

RECENTLY RESOLVED

Tour booking page approval
Resolved today

Property management question
Resolved yesterday
```

A task remaining physically in the Ami List does not automatically mean
Ami still needs to act. The intelligence layer determines whether the
request has already been resolved.

------------------------------------------------------------------------

# 33. Employees Page

Route:

``` text
/employees
```

Example:

``` text
Amin
5 completed
4 active
2 waiting
1 needs Ami

Monica
3 completed
3 active
2 needs Ami

Rayanne
4 completed
2 active
1 waiting
```

------------------------------------------------------------------------

# 34. Employee Detail

Route:

``` text
/employees/[employeeId]
```

Filters:

``` text
Today
Yesterday
This Week
Last Week
Custom
```

Sections:

``` text
Summary
Completed
Active
Waiting
Blocked
Needs Ami
Client Activity
```

Example:

``` text
AMIN | TODAY

Summary:
Amin worked across four clients today.
Most activity focused on VOTH and Studley's.

COMPLETED: 5

Studley's
UTM Builder update

VOTH
Booking pages created

IBEW
Article published

ACTIVE: 4

Fimbel
Advanced Verification

WAITING: 2

VOTH
Waiting on FluentBooking

AAA Pump
Waiting on Global Payments

NEEDS AMI: 1

Studley's
Need Portsmouth wedding photo location
```

------------------------------------------------------------------------

# 35. Since Last Visit

Store:

``` text
ami_last_seen_at
```

Retrieve meaningful events where:

``` text
occurred_at > last_seen_at
```

Example:

``` text
SINCE YOUR LAST VISIT

11:04 AM → 2:34 PM

3 IMPORTANT CHANGES

VOTH
Blocker moved from Eaglenet to FluentBooking.

Fimbel
Google sent another verification reminder.

Studley's
UTM calculator update was completed.

OTHER ACTIVITY

12 low-priority updates hidden
4 tasks appear completed
2 comments are informational
```

Expose:

``` text
Other activity: 12
```

so Ami can inspect lower-priority information if desired.

------------------------------------------------------------------------

# 36. Waiting On View

Route:

``` text
/waiting
```

Tabs:

``` text
Ami
Clients
Vendors
Team
```

Example:

``` text
WAITING ON VENDORS

VOTH
FluentBooking
1 day

Fimbel
Google
3 days

AAA Pump
Global Payments
8 days
```

Example:

``` text
WAITING ON AMI

Studley's
Need wedding photo location

Fimbel
Need confirmation on owner response

CAP
Need copy approval
```

This provides a direct view of organizational bottlenecks.

------------------------------------------------------------------------

# 37. Falling Through the Cracks

Start with deterministic rules.

Examples:

``` text
High priority + no meaningful activity > 72 hours

Client comment + no employee response > 24 hours

Due within 24 hours + not completed

Overdue + unresolved

Waiting on vendor > X days without follow-up

Needs Ami > 48 hours

Agent says completed but ClickUp remains In Progress > 3 days

Task reopened

Multiple client comments without response
```

Example UI:

``` text
POSSIBLY NEEDS ATTENTION

Studley's
Client question has had no response for 22 hours.

Client X
Urgent task has had no activity in 4 days.

VOTH
Calendar integration has been blocked for 3 days.
```

AI can explain a rule-triggered risk, but the initial detection should
remain deterministic where possible.

------------------------------------------------------------------------

# 38. Ask Ami Assistant

Build this after the intelligence layer is reliable.

Route:

``` text
/assistant
```

Suggested questions:

``` text
What's happening with VOTH?

What did Amin work on today?

Who is waiting on me?

Which clients are waiting on us?

What changed since this morning?

What's the biggest problem right now?

What did we complete this week?

Which clients haven't had much activity?

Why is Fimbel still blocked?

Has anyone responded to Studley's?

What do I need to review?
```

------------------------------------------------------------------------

# 39. Ask Assistant Architecture

Do not send the entire ClickUp workspace to the model.

Flow:

``` text
Ami Question
     ↓
Determine Intent
     ↓
Retrieve Relevant Structured Records
     ↓
Retrieve Comments/History If Needed
     ↓
OpenAI
     ↓
Grounded Answer
```

Example:

``` text
Question:
"What's happening with VOTH?"
```

Backend tools:

``` text
get_client_summary(VOTH)
get_active_issues(VOTH)
get_recent_meaningful_events(VOTH)
get_items_needing_ami(VOTH)
```

Then the model produces the answer.

------------------------------------------------------------------------

# 40. Assistant Tools

Expose controlled backend functions such as:

``` text
get_clients()

get_client_summary(client_id)

get_client_tasks(client_id, filters)

get_client_activity(client_id, timeframe)

get_employee_summary(employee_id)

get_employee_activity(employee_id, timeframe)

get_task_details(task_id)

get_task_comments(task_id)

get_items_needing_ami(filters)

get_waiting_items(type)

get_recent_changes(since)

get_overdue_items()

get_stale_items()

search_tasks(query)

search_history(query)
```

Do not give the model arbitrary SQL access.

------------------------------------------------------------------------

# 41. Grounding Rules for Ask Ami

System behavior:

``` text
Answer questions about agency operations only from
data returned by available tools.

If sufficient information is unavailable, say so.

Never invent task status, client responses, deadlines,
decisions or employee activity.

Prefer current intelligence first.

Inspect underlying task/comment history when necessary.

Include source task links whenever useful.
```

Every operational answer should be traceable to ClickUp.

------------------------------------------------------------------------

# 42. Source Links

Each intelligence item should retain:

``` text
clickup_task_id
clickup_url
```

Allow:

``` text
[Open ClickUp Task]
```

For AI answers, show relevant underlying tasks.

Example:

``` text
Based on:
4 tasks
7 meaningful updates
```

This builds trust.

------------------------------------------------------------------------

# 43. Read-Only First

Initial version should not:

``` text
Create tasks
Change status
Change priority
Assign users
Add comments
Delete anything
```

First establish trust.

Later, write actions can be added behind confirmation.

Example future flow:

``` text
Ami:
"Tell Amin to follow up tomorrow."

Assistant:
Add this ClickUp comment?

"Amin, please follow up with FluentBooking tomorrow."

[Confirm] [Cancel]
```

------------------------------------------------------------------------

# 44. Feedback System

Every AI-generated intelligence card should support:

``` text
👍 Accurate
👎 Wrong
```

If wrong:

``` text
Not important
Already completed
Doesn't need Ami
Wrong waiting state
Wrong summary
Other
```

Store this feedback.

Over time it becomes a dataset for improving:

``` text
Prompts
Rules
Scoring
Evaluation cases
Ami-specific preferences
```

------------------------------------------------------------------------

# 45. Evaluation Dataset

Before launch, manually label approximately 100 real ClickUp examples.

For each:

``` text
Agent State
Needs Ami?
Waiting On?
Importance
Meaningful Change?
Correct Summary
```

Example:

``` text
INPUT

Task:
Website Popup

Status:
In Progress

Comment:
"The popup is published. I set it to appear after 50% scroll."

EXPECTED

State:
COMPLETED

Needs Ami:
false

Waiting On:
NONE

Importance:
LOW

Meaningful Change:
true
```

Another:

``` text
INPUT

Comment:
"I reached out to FluentBooking support. I'll post updates
when I hear back."

EXPECTED

State:
WAITING_ON_VENDOR

Waiting On:
FluentBooking

Needs Ami:
false
```

------------------------------------------------------------------------

# 46. Automated AI Evaluations

Every prompt/model change should run against the evaluation dataset.

Track:

``` text
State accuracy
Needs Ami precision
Needs Ami recall
Waiting-on accuracy
Meaningful-change accuracy
Risk accuracy
```

Pay particular attention to:

``` text
Needs Ami false negatives
```

because missing something Ami needs is dangerous.

Also watch:

``` text
Needs Ami false positives
```

because excessive false positives recreate notification overload.

------------------------------------------------------------------------

# 47. Confidence

Have the model return a confidence score.

Example thresholds:

``` text
>= 0.85
Accept normally

0.65 - 0.84
Accept but mark lower confidence internally

< 0.65
Use UNKNOWN or flag for review
```

Do not force certainty when the comments are ambiguous.

------------------------------------------------------------------------

# 48. Prompt Versioning

Version all important prompts:

``` text
TASK_ANALYZER_V1
TASK_ANALYZER_V2
CLIENT_SUMMARIZER_V1
EMPLOYEE_SUMMARIZER_V1
ASSISTANT_SYSTEM_V1
```

Store the prompt version with each AI run.

This lets you determine exactly which prompt produced an incorrect
interpretation.

------------------------------------------------------------------------

# 49. Scheduled Reconciliation

Webhooks should be the primary live mechanism, but periodically
reconcile with ClickUp.

Example:

``` text
Every 2-4 hours
```

Process:

``` text
Retrieve recently modified tasks
Compare ClickUp timestamps with local database
Update missing/stale records
Queue intelligence analysis if necessary
```

Also run a deeper overnight consistency check.

------------------------------------------------------------------------

# 50. Daily Intelligence Job

Some risks emerge because time passes, even if ClickUp does not change.

Every morning reevaluate:

``` text
Needs Ami
Overdue
Due Soon
Stale
Waiting Too Long
Client Health
Employee Summaries
Potential Follow-Up Risks
```

Example:

Yesterday:

``` text
Waiting on FluentBooking for 1 day
```

Three days later, with no webhook:

``` text
Potential follow-up risk:
Waiting on FluentBooking for 4 days with no recorded follow-up.
```

Scheduled intelligence handles this.

------------------------------------------------------------------------

# 51. Security

The system contains internal employee and client data.

Minimum controls:

``` text
Authentication required
HTTPS only
Database not publicly accessible
Secrets stored securely
No API keys client-side
Role-based access
Audit logging
Webhook signature validation
Least-privilege infrastructure permissions
```

For AWS, store production secrets in a proper secret-management service
rather than `.env` files deployed with the application.

------------------------------------------------------------------------

# 52. Logging

Use structured logging.

Webhook log:

``` text
event_id
task_id
event_type
received_at
processed_at
result
```

AI log:

``` text
task_id
model
prompt_version
duration
token usage
confidence
result
```

Failure log:

``` text
error
task_id
job_id
retry_count
timestamp
```

------------------------------------------------------------------------

# 53. Retry Strategy

If ClickUp API fails:

``` text
Retry
```

If OpenAI fails:

``` text
Retry
```

After repeated failures:

``` text
Dead-Letter Queue
```

Admin dashboard should expose:

``` text
Failed jobs
Retry counts
Last error
Task affected
```

Never silently discard activity.

------------------------------------------------------------------------

# 54. Admin/Debug Dashboard

Route:

``` text
/admin
```

Show:

``` text
Webhook health
Last ClickUp event
Queue size
Failed jobs
Tasks awaiting analysis
Last reconciliation
OpenAI calls today
Average processing time
Low-confidence interpretations
Recent errors
Recent intelligence changes
```

Also provide task-level debugging:

``` text
Raw ClickUp data
Recent comments
Previous intelligence
New intelligence
Rule score
AI score
Final score
Prompt version
```

This will be essential while tuning the system.

------------------------------------------------------------------------

# 55. V1 Acceptance Criteria

## Data

``` text
✓ Clients map correctly
✓ Lists map correctly
✓ Tasks map correctly
✓ Comments map correctly
✓ Employees map correctly
✓ Assignees map correctly
```

## Intelligence

``` text
✓ "All set" tasks usually recognized as completed
✓ Waiting states recognized
✓ Needs Ami recognized
✓ Client requests recognized
✓ Blockers recognized
✓ Important events recognized
✓ Waiting party identified correctly
```

## UI

``` text
✓ Home dashboard
✓ Client view
✓ Employee view
✓ Needs Ami
✓ Waiting On
✓ Detail drill-down
✓ Timeline
✓ ClickUp links
✓ Since Last Visit
```

## Reliability

``` text
✓ Webhook verification
✓ Idempotency
✓ Queue
✓ Debouncing
✓ Retries
✓ Reconciliation
✓ Logging
✓ Audit history
```

Only after these are solid should Ask Ami become a major part of the
experience.

------------------------------------------------------------------------

# 56. Shadow Mode

Before Ami depends on the system, run it in shadow mode for
approximately 1-2 weeks.

Flow:

``` text
ClickUp
   ↓
Agent analyzes everything
   ↓
Internal testing view
   ↓
Ami continues normal ClickUp workflow
```

Each day compare:

``` text
What did the agent flag?
What did Ami actually care about?
What did it miss?
What was noisy?
What did it misunderstand?
```

Tune rules and prompts.

------------------------------------------------------------------------

# 57. Initial Ami Release

First real release:

``` text
Dashboard
Clients
Employees
Needs Ami
Waiting On
Since Last Visit
Task Detail
Ask Assistant
```

Keep the application read-only.

Do not automatically send lots of emails, texts or ClickUp
notifications.

The entire purpose is to reduce notification fatigue.

------------------------------------------------------------------------

# 58. Personalization

Once Ami uses the product, collect explicit feedback.

Examples:

If she repeatedly marks:

``` text
Routine page publishing
Minor copy corrections
Internal housekeeping
```

as low importance, ranking can be adjusted.

If she consistently cares about:

``` text
Client complaints
Budget questions
Approvals
Deadlines
Blocked launches
Client responses
```

those categories can rank higher.

Keep critical logic transparent and avoid silently suppressing high-risk
categories.

------------------------------------------------------------------------

# 59. Daily Briefing, Later

Once the portal is trusted, optionally provide a daily briefing.

Example:

``` text
GOOD MORNING, AMI

NEEDS YOU
3 items

CLIENT ISSUES
2 items

WAITING EXTERNALLY
5 items

COMPLETED YESTERDAY
14 meaningful items

POSSIBLY FALLING THROUGH
2 items
```

The briefing should link into the portal.

Do not make the briefing another noisy notification feed.

------------------------------------------------------------------------

# 60. Proactive Intelligence, Later

Advanced versions can identify patterns such as:

``` text
VOTH has had substantially more operational activity
than usual this week.

Fimbel has been waiting on Google for eight days with
no recorded follow-up in the last three days.

Three Studley's tasks currently require Ami's input.

A client has had four unresolved requests this week.

An employee has several tasks that appear completed
but remain marked In Progress.
```

This moves the system from summarization toward real management
intelligence.

------------------------------------------------------------------------

# 61. Recommended Build Phases

## Phase 1: Foundation

Build:

``` text
Next.js project
PostgreSQL
Prisma
ClickUp API connection
Client mapping
List mapping
Employee mapping
Initial task import
Comment import
Raw debug page
```

Goal:

> Accurate local representation of ClickUp.

## Phase 2: Intelligence

Build:

``` text
Agent State
Current Situation
Needs Ami
Waiting On
Importance score
Ami attention score
Risk
Meaningful change detection
Structured OpenAI analysis
```

Goal:

> Correctly understand individual tasks.

## Phase 3: Event Processing

Build:

``` text
ClickUp webhooks
Signature verification
Idempotency
Queue
Debouncing
Worker
Task refresh
Scheduled reconciliation
```

Goal:

> Keep intelligence current automatically.

## Phase 4: Aggregation

Build:

``` text
Client intelligence
Employee intelligence
Client health
Meaningful events
Waiting categories
```

Goal:

> Turn task-level understanding into management-level understanding.

## Phase 5: Ami Portal

Build:

``` text
Home
Clients
Client detail
Employees
Employee detail
Needs Ami
Waiting On
Since Last Visit
Progressive detail
Timeline
ClickUp links
```

Goal:

> Ami can find what she needs without reading ClickUp noise.

## Phase 6: Shadow Testing

Build/run:

``` text
Evaluation dataset
Feedback
Prompt tuning
Rule tuning
Low-confidence review
1-2 week shadow period
```

Goal:

> Establish trust and accuracy.

## Phase 7: Ask Ami

Build:

``` text
Assistant UI
Function calling
Grounded retrieval
Client questions
Employee questions
Historical questions
Operational questions
Source links
```

Goal:

> Ami can ask the system directly instead of navigating manually.

## Phase 8: Advanced Intelligence

Add:

``` text
Falling Through the Cracks
Daily Briefing
Trend Detection
Long-Wait Detection
Client Activity Anomalies
Preference Learning
```

## Phase 9: Controlled Actions

Later:

``` text
Add ClickUp comment
Create task
Assign employee
Change priority
Set due date
```

All write operations should require explicit confirmation initially.

------------------------------------------------------------------------

# 62. Exact Coding Order

This is the recommended implementation sequence.

1.  Create the Next.js project.
2.  Create PostgreSQL.
3.  Install/configure Prisma.
4.  Add environment variables.
5.  Connect to ClickUp.
6.  Write a ClickUp discovery script.
7.  Print Spaces/Folders/Lists and IDs.
8.  Map one client manually, preferably VOTH.
9.  Create `clients`.
10. Create `clickup_lists`.
11. Create `employees`.
12. Create `tasks`.
13. Create `task_assignees`.
14. Create `comments`.
15. Create initial sync script.
16. Import VOTH tasks.
17. Import VOTH comments.
18. Build `/debug/voth`.
19. Compare at least 20 tasks manually with ClickUp.
20. Fix any ingestion problems.
21. Create `task_intelligence`.
22. Manually label 20 real VOTH examples.
23. Connect OpenAI.
24. Create strict structured task-analysis schema.
25. Create task analyzer prompt V1.
26. Run the 20 examples.
27. Compare expected vs actual.
28. Improve prompt and context builder.
29. Expand evaluation dataset to 50-100 examples.
30. Add deterministic rule engine.
31. Add importance score.
32. Add Ami attention score.
33. Add state comparison.
34. Add `meaningful_events`.
35. Add ClickUp webhook endpoint.
36. Add signature verification.
37. Add idempotency.
38. Add SQS/queue.
39. Add debounce logic.
40. Add worker.
41. Refresh task/comments before analysis.
42. Store intelligence runs.
43. Add retries.
44. Add dead-letter handling.
45. Add scheduled reconciliation.
46. Add client aggregation.
47. Add client health.
48. Add employee aggregation.
49. Build Home dashboard.
50. Build Needs Ami.
51. Build Clients page.
52. Build Client detail.
53. Build Ami List view.
54. Build Notifications view.
55. Build Employees page.
56. Build Employee detail.
57. Build Waiting On.
58. Build Since Last Visit.
59. Build progressive detail modal/page.
60. Add timeline.
61. Add direct ClickUp links.
62. Build admin/debug dashboard.
63. Add feedback buttons.
64. Run shadow mode.
65. Review results daily.
66. Tune rules.
67. Tune prompts.
68. Tune scoring.
69. Validate false negatives for Needs Ami.
70. Validate false positives for Needs Ami.
71. Give Ami read-only access.
72. Observe real usage.
73. Build Ask Ami.
74. Add assistant backend tools.
75. Add grounded source references.
76. Test assistant against real questions.
77. Add Falling Through the Cracks.
78. Add optional daily briefing.
79. Add advanced trend detection.
80. Consider controlled ClickUp write actions only after the system is
    trusted.

------------------------------------------------------------------------

# 63. First Practical Milestone

Do not begin by building the chatbot.

The first target should be:

``` text
ClickUp
   ↓
VOTH Ami List + Notifications List
   ↓
Tasks
   ↓
Comments
   ↓
PostgreSQL
   ↓
/debug/voth
```

Success means:

> You can open `/debug/voth` and see an accurate local representation of
> VOTH's ClickUp tasks, comments, assignments, priorities, dates,
> statuses and Lists.

Then add:

``` text
Raw VOTH Data
   ↓
OpenAI Task Analyzer
   ↓
Agent State
Current Situation
Needs Ami
Waiting On
Importance
```

Only after the system reliably understands individual tasks should you
aggregate clients and employees.

------------------------------------------------------------------------

# 64. Second Practical Milestone

For 20 real tasks, display:

``` text
Task:
Outlook Calendar Integration

ClickUp Status:
In Progress

Agent State:
Waiting on Vendor

Current Situation:
Eaglenet approved the requested Microsoft permissions,
but FluentBooking continues requesting administrator consent.

Waiting On:
FluentBooking

Needs Ami:
No

Importance:
78

Confidence:
96%

Last Meaningful Change:
Blocker shifted from Eaglenet to FluentBooking.
```

Manually verify each result.

This milestone proves the intelligence layer works.

------------------------------------------------------------------------

# 65. Third Practical Milestone

Once individual tasks are reliable, create:

``` text
VOTH

Health:
ATTENTION

Current Situation:
The Outlook calendar integration is the primary outstanding
issue. Other recent website and booking-page work has been
completed.

Needs Ami:
0

Waiting Externally:
1

Completed Today:
3

Last Meaningful Activity:
22 minutes ago
```

Now you have real client intelligence.

------------------------------------------------------------------------

# 66. Fourth Practical Milestone

Create:

``` text
AMIN | TODAY

Completed:
5

Active:
4

Waiting:
2

Needs Ami:
1

Clients:
VOTH
Studley's
Fimbel
IBEW
```

Now you have employee intelligence.

------------------------------------------------------------------------

# 67. Fifth Practical Milestone

Create the Ami home page:

``` text
AMI ASSISTANT

3 Need You
5 Important

Since Last Visit
7 meaningful updates

Clients
Employees

Waiting On
Ami: 5
Clients: 4
Vendors: 3

Potential Problems
2
```

At this point the application is already useful even without chat.

------------------------------------------------------------------------

# 68. Sixth Practical Milestone

Add Ask Ami.

Example:

``` text
Ami:
"What's happening with VOTH?"
```

Assistant retrieves structured client intelligence and relevant task
history, then answers:

``` text
VOTH's primary outstanding issue is the Outlook calendar
integration. Eaglenet has completed the Microsoft permission
work, but FluentBooking is still requesting admin consent.
Amin escalated the issue to FluentBooking support today.

Nothing currently requires your action.
```

With:

``` text
[Open Outlook Calendar Integration in ClickUp]
```

That completes the core product vision.

------------------------------------------------------------------------

# 69. Final Product Principle

The product should never become another stream of raw notifications.

The desired transformation is:

``` text
CLICKUP ACTIVITY

"Comment posted"
"Status changed"
"Attachment uploaded"
"Priority changed"
"Comment posted"
"Task updated"
```

into:

``` text
MANAGEMENT INTELLIGENCE

VOTH calendar issue progressed but remains blocked.

Eaglenet completed its part.
The remaining blocker is FluentBooking.
Amin has already escalated it.
Ami does not currently need to act.
```

And when Ami wants more:

``` text
Click
   ↓
Details
   ↓
Timeline
   ↓
Original ClickUp Task
```

The central design rule is:

> **Ami should not have to interpret ClickUp activity. The assistant
> should interpret the activity, surface what matters, and preserve
> access to the underlying evidence.**

------------------------------------------------------------------------

# 70. Architecture Summary

``` text
CLICKUP
   │
   ├── Webhooks
   └── Scheduled Reconciliation
            │
            ↓
       Event Ingestion
            │
            ↓
          Queue
            │
            ↓
          Worker
            │
      ┌─────┴─────┐
      │           │
 ClickUp API   PostgreSQL
      │           │
      └─────┬─────┘
            ↓
      Context Builder
            │
      ┌─────┴─────┐
      │           │
 Rule Engine    OpenAI
      │           │
      └─────┬─────┘
            ↓
       State Engine
            │
            ↓
    Intelligence Store
            │
   ┌────────┼─────────┐
   │        │         │
Clients Employees Needs Ami
   │        │         │
   └────────┼─────────┘
            ↓
      Ami Command Center
            │
   ┌────────┼─────────┐
   │        │         │
Dashboard Details   Ask AI
```

The database stores facts. The rule engine handles deterministic
signals. OpenAI interprets human language and context. The state engine
identifies what materially changed. The portal exposes the resulting
intelligence in client and employee views. Ask Ami sits on top of the
same trusted intelligence layer rather than operating directly on an
unstructured ClickUp feed.
