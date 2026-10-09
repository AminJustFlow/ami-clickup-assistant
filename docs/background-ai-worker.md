# Budgeted background AI analysis (first implementation)

This worker processes **already imported** ClickUp tasks using the existing validated AI analyzer. It does **not** refresh ClickUp or write to ClickUp. Its fingerprint cache skips unchanged tasks; the dashboard can remain useful before all tasks are analyzed.

## Installation and safe preview

Pull `feature/clean-operations-ui`, then run `npm install`, `npm run typecheck`, and `npm run build`.

Read-only preview for the consolidated Fimbel group:

```cmd
npm run clients:auto -- --client fimbel-garage-doors-fmb-90146979789 --max-ai 25 --input-rate 0.20 --output-rate 1.20 --max-usd 0.50 --daily-usd 2.00 --once
```

This preview does not call OpenAI or write database rows.

## Start a budgeted worker

**Requires explicit authorization of the selected spending limits.** To start it in a dedicated terminal:

```cmd
npm run clients:auto -- --client fimbel-garage-doors-fmb-90146979789 --max-ai 25 --input-rate 0.20 --output-rate 1.20 --max-usd 0.50 --daily-usd 2.00 --interval-minutes 15 --execute
```

This runs up to 25 pending analyses per cycle and waits 15 minutes between cycles. Existing cached analyses are skipped. It will stop when the next estimated batch exceeds the per-cycle budget, or pause until the next UTC day when the daily *reservation* budget is exhausted. The local ledger `data/ai-worker-budget.json` persists across restarts, and the lock `data/ai-worker.lock` prevents two copies of this worker from sharing the same local ledger. Do not delete the ledger to reset spending limits.

`--once --execute` runs a single paid cycle for controlled verification. Ctrl+C stops the worker after the current cycle. Keep the terminal open or use a process manager. **Do not start multiple worker instances on different machines sharing the same OpenAI project:** the ledger and lock are local, not shared. Also do not run manual paid analysis in parallel; it is not counted against the worker's ledger.

**Important:** These are estimated reservation limits, **not a hard provider billing cap**. Actual token usage, reasoning tokens, retries, and provider pricing may differ. Set provider-side project budget alerts/limits as appropriate. Failed requests may still be billed, and reservations are intentionally not refunded. If the worker or subprocess crashes, the reservation remains counted. If a task fails, investigate before restarting.

The worker uses the existing model configured in `OPENAI_INTELLIGENCE_MODEL` and manually supplied USD-per-million-token rates. Validate rates before executing.

## Current limitations / next milestones

- Client scope is one consolidated client group per worker, using `--client`. Multi-client orchestration is not yet implemented.
- Existing VOTH ClickUp sync is separate. **Non-VOTH imported clients are not continuously refreshed from ClickUp yet**; incremental AI re-analysis happens when local task data changes through an import or future sync.
- The worker uses a local file-based ledger, not a distributed/transactional budget tracker; production deployment needs a database-backed reservation/lease and stronger reconciliation.
- The worker launches the existing analyzer in a child process, and is not a hosted scheduler; Next.js alone will not run it.
- Do not merge to `main` without approval.
