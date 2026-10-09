import { loadEnvConfig } from '@next/env';
import { prisma } from '../lib/db/prisma';
import { parseCostOptions, calculateCostPlan, printCostPlan } from '../lib/intelligence/cost-plan';

loadEnvConfig(process.cwd());
async function main() {
  const options = parseCostOptions(process.argv.slice(2));
  const plan = await calculateCostPlan(options);
  printCostPlan(plan, options);
  console.log('\nDry run complete: no OpenAI calls were made and no database rows were modified.');
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
