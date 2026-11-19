import { TASK_ANALYZER_PROMPT_VERSION } from './prompt';

type CoverageTask = {
  clickupUpdatedAt: Date | null;
  intelligence: {
    analyzedAt: Date | null;
    freshnessStatus: string | null;
    classificationVersion: string | null;
    verificationStatus: string | null;
  } | null;
  comments: { clickupCreatedAt: Date | null; clickupUpdatedAt: Date | null }[];
};

export function intelligenceCoverage(tasks: CoverageTask[]) {
  let current = 0;
  let stale = 0;
  let unanalyzed = 0;
  let verification = 0;
  for (const task of tasks) {
    const intel = task.intelligence;
    if (!intel) {
      unanalyzed++;
      continue;
    }
    const analyzed = intel.analyzedAt?.getTime() ?? 0;
    const sourceChanged = (date: Date | null) => !!date && date.getTime() > analyzed;
    if (!analyzed || intel.classificationVersion !== TASK_ANALYZER_PROMPT_VERSION ||
        intel.freshnessStatus !== 'CURRENT' || sourceChanged(task.clickupUpdatedAt) ||
        task.comments.some(c => sourceChanged(c.clickupCreatedAt) || sourceChanged(c.clickupUpdatedAt))) stale++;
    else current++;
    if (intel.verificationStatus === 'VERIFY') verification++;
  }
  return { current, stale, unanalyzed, verification };
}

export function coverageDescription(tasks: CoverageTask[]) {
  const counts = intelligenceCoverage(tasks);
  return `${tasks.length} imported tasks ? ${counts.current} current assessments ? ${counts.stale} stale or uncertain ? ${counts.unanalyzed} unanalyzed. ${counts.verification} assessments flagged for verification.`;
}
