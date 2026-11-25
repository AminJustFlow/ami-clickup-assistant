-- Keep history while removing unsupported progress from all verified feeds.
UPDATE "OperationalUpdate"
SET "verified" = false
WHERE "kind" = 'PROGRESS'
  AND "verified"
  AND ("evidenceAt" IS NULL OR trim("summary") ~* '^no (substantive|meaningful|material|documented|recorded|new|actual) (work|progress|execution|operational|change|activity)\y');
