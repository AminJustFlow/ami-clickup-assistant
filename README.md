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

The worker checks ClickUp every five minutes by default. It polls the VOTH Lists for new/updated/deleted tasks, refreshes assignees and comments for changed tasks, and consumes pending signed ClickUp webhook events (including comment changes that do not change a task's `date_updated`). The worker does NOT call OpenAI. AI analysis requires a separate explicit approval and cost preview. The worker updates `Client.lastSyncedAt` only after a successful pass; the dashboard displays the last successful VOTH sync time and warns when it is more than 15 minutes old.

To run a single cycle and inspect the result:

```bash
npm run clickup:auto:voth:once
```

Optional `.env.local` setting: `CLICKUP_SYNC_INTERVAL_MINUTES=5` (allowed 1–1440). The worker needs `DATABASE_URL`, `CLICKUP_API_TOKEN`, `OPENAI_API_KEY` and, when using the webhook, `CLICKUP_WEBHOOK_SECRET`. Keep the worker running in a dedicated terminal or process manager; **starting Next.js alone does not run the worker**. If deployed, configure exactly one worker instance. Do not run the full initial sync concurrently with the worker.

The existing `/api/webhooks/clickup` endpoint validates ClickUp's HMAC signature and stores events for the worker. Configure a ClickUp webhook pointing to your publicly reachable HTTPS application URL if you need rapid detection of comment-only updates. Without a webhook, the polling worker catches task changes but may miss comment-only changes until ClickUp updates the parent task timestamp or a manual full sync is run.

This implementation **never writes to ClickUp**. It does write imported data and AI results to PostgreSQL. It currently refreshes **VOTH only**, not all clients. Keep the dashboard behind your existing internal access controls before deploying publicly. Avoid exposing API credentials in logs or source control.

A successful TypeScript build does not prove external API connectivity. Verify the worker with a real ClickUp test comment, watch the console, and confirm the dashboard timestamp and task detail comments change.


## Onboard additional ClickUp clients

The dashboard supports multiple clients. Client onboarding uses **ClickUp folders** as the client boundary. Folderless lists are not imported, and VOTH is excluded by default to protect its existing setup.

1. Preview candidate folders (read-only, no database writes):

```bash
npm run clients:preview
```

2. Review the names and Folder IDs. Start with **one additional client** using the exact ID printed in the preview:

```bash
npm run clients:import -- --folder-id YOUR_FOLDER_ID
```

3. Refresh the dashboard. The client appears with an imported task count and an **Imported — awaiting AI analysis** section. Importing alone does **not** generate AI recommendations.

4. Preview the estimated cost with your model's **current official API rates** (USD per million input/output tokens):

```bash
npm run clients:estimate -- --input-rate INPUT_RATE --output-rate OUTPUT_RATE --include-voth
```

5. Only after reviewing the estimate, explicitly authorize a limited batch:

```bash
npm run clients:analyze -- --input-rate INPUT_RATE --output-rate OUTPUT_RATE --max-ai 25 --max-usd 5 --execute
```

The analyzer defaults to a dry-run estimate. Without `--execute` and `--max-usd`, no AI requests are made. The budget gate uses conservative **estimated** tokens and is NOT a guaranteed API billing cap; retries and actual output tokens may exceed estimates. For strict billing protection, also set an API project budget/usage alert with the provider.

For a particular client, use `npm run clients:analyze -- --client CLIENT_SLUG --max-ai 25`; the slug is visible in the client URL after importing. The analyzer skips tasks whose saved AI fingerprint still matches the evidence. Rerun to continue with more tasks. Cost estimates are calculated from the imported data, not the live ClickUp API. They include complete chronological task comments but only excerpts from related tasks, and do not include attachment contents, checklist items, custom fields, external files, or time tracking. These gaps are shown in the coverage audit; do not represent the current AI output as complete ClickUp context until those sources are ingested and validated.

6. After verifying the first additional client, import all eligible folders:

```bash
npm run clients:import
```

Or limit the import to a Space or a few folders with `--space-id SPACE_ID` and `--limit-clients 3`. Run `npm run clients:preview -- --space-id SPACE_ID` to inspect the same selection without writing anything.

**Important:** This is an onboarding import, not yet a multi-client continuous sync worker. The automatic refresh worker still covers **VOTH only**. Do not assume newly imported clients update automatically until the multi-client refresh worker is implemented. AI analysis uses your OpenAI API key and may incur charges; `--max-ai` limits the number of successful AI calls in a run (failures may also initiate calls). No changes are written to ClickUp.

## AI cost and context safeguards

The cost estimator runs entirely offline against PostgreSQL; it does not call OpenAI. It reports imported tasks, cached analyses, pending model calls, comments, attachment references, checklists and custom fields per client. Pass the latest provider rates explicitly with `--input-rate` and `--output-rate` (USD per million tokens). The default model is controlled by `OPENAI_INTELLIGENCE_MODEL`; verify that it exists and check its current pricing before approval. The character-to-token estimate uses a safety multiplier but cannot guarantee final charges or context-window fit. `npm run clients:analyze` also performs the estimate before any call and requires `--execute --max-usd N`. The VOTH background worker syncs data only; it no longer automatically spends on AI.

## Full-context ClickUp audit (before paid AI analysis)

Task intelligence now includes imported ClickUp checklist item names, completion flags, item assignees, custom-field values, parent task IDs, dependency and linked-task references, relevant task dates and attachment filenames/metadata. The model is explicitly instructed **not** to claim it has read attachment file contents. The intelligence prompt version was incremented, invalidating earlier cached summaries because the evidence changed.

ClickUp's list-task response can omit full task fields. Compare a small sample of live full-task responses to the stored task payload, with **no database changes and no OpenAI calls**:

```bash
npm run clickup:audit-detail -- --limit 5
```

For a specific imported folder/client, first inspect the client's slug from the cost report, then sample:

```bash
npm run clickup:audit-detail -- --client fimbel-garage-doors-fmb-90146979789 --limit 10
```

Only if the live full-task API exposes additional data worth storing, explicitly enrich a limited number of tasks in **one** folder:

```bash
npm run clickup:audit-detail -- --client fimbel-garage-doors-fmb-90146979789 --limit 10 --apply --confirm
```

Enrichment fetches full task metadata from ClickUp, merges it into the stored raw payload, and never calls OpenAI. It does **not** download attachments, transcribe files, ingest linked documents, retrieve all activity history or unify separate invoicing/client folders. These are remaining requirements before claiming comprehensive cross-folder intelligence. Re-run `npm run clients:estimate` after enrichment to see the increased context and estimated costs. If the full task response is missing fields, the audit makes that gap visible rather than silently claiming coverage.

## Consolidated client folders (read-only)

The client detail page now groups a canonical folder with related invoicing, monthly-budget, and no-go folders **only** when a unique client acronym is explicit in both names. Example: `Fimbel Garage Doors (FMB)`, `FMB Invoiced Projects`, and `FMB NO GO Projects`. The underlying ClickUp folders and local database rows are not merged or changed. Task cards retain their source folder name. Ambiguous and unlabeled folders remain separate; they require an explicit mapping review.

Inspect grouping, task counts, attachment metadata and whether dependency IDs resolve to tasks in the same client group:

```bash
npm run clients:audit-groups -- --client fimbel-garage-doors-fmb-90146979789
npm run clients:audit-groups -- --limit 20
```

This audit reads the local database only and never calls OpenAI or modifies records. Dependencies are reported as **references**, not interpreted as blockers or approvals. The AI analyzer still limits related-task retrieval to its conservative matching rules; this dashboard consolidation does not yet imply cross-folder AI evidence ingestion. Attachments and linked documents remain an explicit coverage gap.

## Dependency-aware consolidated client analysis

The AI cost estimator and opt-in analyzer now use the same consolidated client grouping as the dashboard. Exact ClickUp dependency task IDs are ranked above title similarity when selecting related evidence, but dependencies do not prove an active blocker or approval requirement. The analyzer continues to use at most three related-task excerpts per task, and unrelated client folders are not searched. The prompt is versioned to invalidate previous cached analyses when the evidence logic changes.

Before any paid analysis, validate locally:

```bash
npm run typecheck
npm run build
npm run intelligence:test-dependencies
npm run intelligence:audit-related -- --client fimbel-garage-doors-fmb-90146979789 --limit 5
npm run clients:estimate -- --client fimbel-garage-doors-fmb-90146979789 --input-rate YOUR_VERIFIED_RATE --output-rate YOUR_VERIFIED_RATE
```

All of these commands are read-only with respect to OpenAI and the database. The input/output rates are user-supplied assumptions, not verified live model prices. Never add `--execute` to the analyzer until the user explicitly approves a paid pilot and the model/prices are checked. Attachment contents and external linked documents remain outside the evidence set.


## Full-task metadata ingestion for every client (October 2026)

The shared `importTask` path now calls ClickUp's full-task endpoint for **every newly imported or refreshed task**, including all JF Corporate client folders and VOTH. It merges list and detail payloads before saving so that attachment metadata available only from full-task responses is captured. This adds approximately one ClickUp task-detail API request per imported/changed task; the API client retries HTTP 429 and transient server errors. Imports can take substantially longer and may encounter ClickUp rate limits. This is a change to **future imports**, not an automatic background refresh for non-VOTH clients.

To backfill **already imported** tasks for one consolidated client, use bounded, resumable batches (writes **local PostgreSQL only**):

```bash
npm run clickup:audit-detail -- --client fimbel-garage-doors-fmb-90146979789 --limit 200 --missing-detail --apply --confirm
```

Rerun until `Pending full-detail enrichment in scope: 0` and `Selected: 0 tasks`. Each successful task receives a `_fullTaskFetchedAt` marker, so subsequent batches skip it; failed tasks remain eligible for retry. This script preserves existing comments and task-intelligence rows, does not write to ClickUp, does not download attachment file contents, and makes **no OpenAI calls**. Afterward run `npm run intelligence:audit-context -- --client fimbel-garage-doors-fmb-90146979789` and `npm run clients:estimate -- --client fimbel-garage-doors-fmb-90146979789 --input-rate YOUR_RATE --output-rate YOUR_RATE` to verify coverage and re-estimate AI cost.

To inspect without writing, omit `--apply --confirm`. Only use `--client` for writes; the audit intentionally refuses global database enrichment. Other clients' **future imports** use full task details automatically, but their existing records need the same explicit per-client backfill if completeness is required. Do not run an initial import and a backfill concurrently for the same client.
