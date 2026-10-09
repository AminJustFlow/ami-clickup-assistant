SELECT
  (SELECT count(*) FROM "Client") AS clients,
  (SELECT count(*) FROM "Task") AS tasks,
  (SELECT count(*) FROM "TaskIntelligence") AS intelligence,
  (SELECT count(*) FROM "IntelligenceReview") AS reviews;
SELECT status, count(*) FROM "AnalysisJob" GROUP BY status ORDER BY status;
SELECT day, "reservedUsd", "actualEstimatedUsd", "inputTokens", "outputTokens", "successfulJobs", "failedJobs" FROM "AiBudgetDay" ORDER BY day DESC LIMIT 2;
SELECT name, status, "lastSeenAt", "lastError" FROM "WorkerHeartbeat" ORDER BY name;
SELECT status, count(*) FROM "SyncRun" GROUP BY status ORDER BY status;
