import { loadEnvConfig } from '@next/env';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { prisma } from '../lib/db/prisma';
import { calculateCostPlan, parseCostOptions } from '../lib/intelligence/cost-plan';

loadEnvConfig(process.cwd());

/**
 * Budgeted, resumable worker for previously imported client tasks.
 * Uses the same fingerprint cache and analyzer as the validated manual batches.
 * This is NOT a ClickUp importer or a hard provider billing limit.
 */
const args = process.argv.slice(2);
const arg = (name: string) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const once = args.includes('--once');
const execute = args.includes('--execute');
const client = arg('--client');
const batch = Number(arg('--max-ai') ?? '25');
const interval = Number(arg('--interval-minutes') ?? '15');
const dailyUSD = Number(arg('--daily-usd'));
const cycleUSD = Number(arg('--max-usd'));
const inputRate = Number(arg('--input-rate') ?? process.env.AI_INPUT_USD_PER_MILLION);
const outputRate = Number(arg('--output-rate') ?? process.env.AI_OUTPUT_USD_PER_MILLION);
const ledgerPath = resolve(process.cwd(), 'data', 'ai-worker-budget.json');
const lockPath = resolve(process.cwd(), 'data', 'ai-worker.lock');

if (!client) throw new Error('Specify --client CLIENT_SLUG to restrict the background worker to one verified client group.');
if (!Number.isInteger(batch) || batch < 1 || batch > 250) throw new Error('--max-ai must be 1-250.');
if (!Number.isInteger(interval) || interval < 1 || interval > 1440) throw new Error('--interval-minutes must be 1-1440.');
if (![dailyUSD, cycleUSD].every(n => Number.isFinite(n) && n > 0) || cycleUSD > dailyUSD) {
  throw new Error('Specify positive --daily-usd and --max-usd; cycle budget cannot exceed daily budget.');
}
if (![inputRate, outputRate].every(n => Number.isFinite(n) && n >= 0)) {
  throw new Error('Specify --input-rate and --output-rate (USD per million tokens).');
}
if (!execute && !once) throw new Error('Continuous worker requires --execute. Use --once without --execute to preview safely.');
if (execute && !process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required for --execute.');

type Ledger = { day: string; reservedUSD: number; runs: number };
const dayUTC = () => new Date().toISOString().slice(0, 10);
function readLedger(): Ledger {
  if (!existsSync(ledgerPath)) return { day: dayUTC(), reservedUSD: 0, runs: 0 };
  const value = JSON.parse(readFileSync(ledgerPath, 'utf8')) as Ledger;
  if (!Number.isFinite(value.reservedUSD) || value.reservedUSD < 0) throw new Error('Invalid AI worker ledger; refusing to spend.');
  return value.day === dayUTC() ? value : { day: dayUTC(), reservedUSD: 0, runs: 0 };
}
function writeLedger(value: Ledger) {
  const tmp = ledgerPath + '.tmp';
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { flag: 'w' });
  renameSync(tmp, ledgerPath);
}
function executeBatch(limit: number, budget: number): Promise<number> {
  const childArgs = ['run', 'clients:analyze', '--', '--client', client!, '--max-ai', String(limit),
    '--input-rate', String(inputRate), '--output-rate', String(outputRate),
    '--max-usd', String(budget), '--execute'];
  return new Promise((resolveExit, reject) => {
    const child = spawn('npm', childArgs, { stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('error', reject);
    child.on('close', code => resolveExit(code ?? 1));
  });
}

let stopping = false;
process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });

async function cycle() {
  const options = parseCostOptions(['--client', client!, '--max-ai', String(batch),
    '--input-rate', String(inputRate), '--output-rate', String(outputRate)]);
  const plan = await calculateCostPlan(options);
  console.log('[AI worker] ' + client + ': ' + plan.pending + ' pending in next batch, ' + plan.cached +
    ' cached in scanned scope, estimated $' + plan.estimatedUSD.toFixed(4));
  if (!execute) { console.log('[AI worker] Preview only: no paid calls or database changes.'); return 'preview'; }
  if (!plan.pending) { console.log('[AI worker] Client is up to date.'); return 'idle'; }
  const ledger = readLedger();
  // Reserve worst-case input/output estimate before spawning the paid analyzer.
  // This is conservative accounting, not a hard OpenAI API spend limit.
  const upper = plan.pending * ((plan.maxTaskInputTokens * inputRate + options.outputTokens * outputRate) / 1_000_000);
  const reserve = Math.ceil(upper * 10000) / 10000;
  if (reserve > cycleUSD) {
    console.log('[AI worker] Batch upper estimate $' + reserve.toFixed(4) +
      ' exceeds cycle budget $' + cycleUSD.toFixed(2) + '. Reduce --max-ai or increase the explicitly authorized cycle budget.');
    return 'budget';
  }
  if (ledger.reservedUSD + reserve > dailyUSD + 1e-9) {
    console.log('[AI worker] Daily reservation budget reached ($' + ledger.reservedUSD.toFixed(4) +
      ' / $' + dailyUSD.toFixed(2) + ' UTC day). Waiting for next day.');
    return 'budget';
  }
  writeLedger({ day: ledger.day, reservedUSD: ledger.reservedUSD + reserve, runs: ledger.runs + 1 });
  console.log('[AI worker] Reserved $' + reserve.toFixed(4) + ' estimated for up to ' + plan.pending + ' paid attempts.');
  const exitCode = await executeBatch(plan.pending, cycleUSD);
  if (exitCode !== 0) {
    console.error('[AI worker] Analyzer exited ' + exitCode + '; reserved budget remains charged as a safety margin. Stopping to prevent retry loops.');
    stopping = true;
    return 'failed';
  }
  return 'success';
}

async function main() {
  mkdirSync(resolve(process.cwd(), 'data'), { recursive: true });
  // Lock prevents two worker instances from spending against the same local ledger.
  let fd: number | undefined;
  if (execute) {
    try { fd = openSync(lockPath, 'wx'); }
    catch { throw new Error('AI worker lock exists. Stop the other worker or remove a verified stale lock: ' + lockPath); }
  }
  try {
    console.log('[AI worker] ' + (execute ? 'PAID MODE' : 'READ-ONLY PREVIEW') +
      ' | client=' + client + ' | maxAI=' + batch + ' | cycle=$' + cycleUSD +
      ' | UTC daily reservation=$' + dailyUSD + ' | interval=' + interval + 'm');
    do {
      try { await cycle(); }
      catch (error) { console.error('[AI worker] Error:', error); stopping = true; process.exitCode = 1; }
      if (once || stopping) break;
      await new Promise<void>(r => setTimeout(r, interval * 60_000));
    } while (!stopping);
  } finally {
    if (fd !== undefined) { closeSync(fd); unlinkSync(lockPath); }
    await prisma.$disconnect();
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
