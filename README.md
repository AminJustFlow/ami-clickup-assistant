# Ami ClickUp Assistant

Internal operations-intelligence layer for ClickUp. The system is designed around two primary views: **Clients** and **Employees**, with inferred operational state based heavily on comments rather than relying on ClickUp status alone.

## Current milestone

This repository contains the V1 foundation:

- Next.js + TypeScript application structure
- PostgreSQL/Prisma data model
- Workspace/Space/client-Folder/List mapping model
- Employee, task, assignee, comment and event storage
- ClickUp discovery script
- Initial ClickUp task/comment sync
- Raw-data debug page
- HMAC-verified ClickUp webhook endpoint with idempotent event persistence
- Agent-state and structured intelligence schema
- Initial deterministic priority scoring
- OpenAI prompt boundary/scaffolding

The AI analyzer is intentionally not activated until raw ClickUp ingestion is verified against real data.

## 1. Requirements

- Node.js 20+
- PostgreSQL
- ClickUp API token
- ClickUp Workspace ID
- OpenAI API key for the later intelligence milestone

## 2. Install

```bash
npm install
cp .env.example .env.local
```

Fill in `.env.local`.

## 3. Database

Create a PostgreSQL database and set `DATABASE_URL`, then run:

```bash
npm run db:generate
npm run db:migrate -- --name initial
```

## 4. Discover ClickUp hierarchy

Set `CLICKUP_API_TOKEN` and `CLICKUP_WORKSPACE_ID` in `.env.local` (or `.env`), then run:

```bash
npm run clickup:discover
```

This validates authentication, prints the configured Workspace hierarchy and known-List sanity check, highlights possible Ami/Notification Lists, and writes metadata-only output to `data/clickup-discovery.json`.

## 5. Import the first client

The first raw-data client is the ClickUp Folder `The Village on Technology Hill (VTH)`. Its Folder and List IDs are resolved from discovery metadata and refreshed against ClickUp during sync:

```bash
npm run clickup:sync:voth
```

The importer includes open and closed tasks, assignees, and complete paginated comment history. It is idempotent by ClickUp IDs.

## 6. Initial sync

Validate database integrity and print keyword-selected examples with `npm run clickup:validate:voth`.

## 7. Run the app

```bash
npm run dev
```

Open:

- `/` for the project shell
- `/debug/tasks` to validate raw imported ClickUp data
- `/debug/voth` for the complete filterable VOTH raw-data view
- `/api/health` for health status

## 8. Validation gate

Before enabling AI, manually compare at least 20 imported tasks against ClickUp and confirm:

- Correct client
- Correct List
- Correct task title/description
- Correct ClickUp status
- Correct priority
- Correct assignees
- Correct recent comments
- Correct ClickUp link

## 9. Next milestone

After raw-data validation:

1. Build the OpenAI Structured Output task analyzer.
2. Label 20 real tasks manually with expected Agent State, Needs Ami, Waiting On and importance.
3. Run the analyzer against those fixtures.
4. Add task-intelligence persistence.
5. Add meaningful-change detection.
6. Add webhook queue/debouncing and task refresh.
7. Expand evaluation fixtures to 50-100 cases.
8. Build Client and Employee aggregation.
9. Build the Ami dashboard.
10. Add Ask Ami only after the intelligence layer is reliable.

## Operational states

```text
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

`needs_ami` and `waiting_on` are separate dimensions. Importance and Ami-attention are also separate scores.


## Phase 2 intelligence shadow mode

Phase 2 adds a deterministic intelligence pass before live model analysis. This gives us explainable baseline behavior and a regression suite for real VOTH patterns.

Run the fixture evaluation:

```bash
npm run intelligence:evaluate
```

Analyze the VOTH tasks already stored in PostgreSQL:

```bash
npm run intelligence:analyze:voth
```

Then start the app and open:

```text
/debug/voth/intelligence
```

The shadow view shows inferred operational state, Needs Ami, waiting party, importance, Ami attention, risk, confidence, the latest meaningful change, and the underlying ClickUp evidence.

Important: an Ami mention alone does not mean Ami needs to act. Direct requests to Ami do. Comments are processed chronologically so newer operational evidence can supersede an older state.

This rule engine is the baseline for the structured OpenAI analyzer. We will evaluate the model against the same cases and merge rule + model evidence rather than replacing deterministic signals.


## Automatic VOTH ClickUp refresh (read-only)

After the initial VOTH import and AI analysis, start the app and the refresh worker in **two separate terminals**:

```bash
npm run dev
npm run clickup:auto:voth
```

The worker checks ClickUp every five minutes by default. It polls the VOTH Lists for new/updated/deleted tasks, refreshes assignees and comments for changed tasks, and consumes pending signed ClickUp webhook events (including comment changes that do not change a task's `date_updated`). It reuses the AI source fingerprint to avoid repeating AI calls for unchanged evidence. Related-task changes can also invalidate fingerprints. The worker updates `Client.lastSyncedAt` only after a successful pass; the dashboard displays the last successful VOTH sync time and warns when it is more than 15 minutes old.

To run a single cycle and inspect the result:

```bash
npm run clickup:auto:voth:once
```

Optional `.env.local` setting: `CLICKUP_SYNC_INTERVAL_MINUTES=5` (allowed 1–1440). The worker needs `DATABASE_URL`, `CLICKUP_API_TOKEN`, `OPENAI_API_KEY` and, when using the webhook, `CLICKUP_WEBHOOK_SECRET`. Keep the worker running in a dedicated terminal or process manager; **starting Next.js alone does not run the worker**. If deployed, configure exactly one worker instance. Do not run the full initial sync concurrently with the worker.

The existing `/api/webhooks/clickup` endpoint validates ClickUp's HMAC signature and stores events for the worker. Configure a ClickUp webhook pointing to your publicly reachable HTTPS application URL if you need rapid detection of comment-only updates. Without a webhook, the polling worker catches task changes but may miss comment-only changes until ClickUp updates the parent task timestamp or a manual full sync is run.

This implementation **never writes to ClickUp**. It does write imported data and AI results to PostgreSQL. It currently refreshes **VOTH only**, not all clients. Keep the dashboard behind your existing internal access controls before deploying publicly. Avoid exposing API credentials in logs or source control.

A successful TypeScript build does not prove external API connectivity. Verify the worker with a real ClickUp test comment, watch the console, and confirm the dashboard timestamp and task detail comments change.
