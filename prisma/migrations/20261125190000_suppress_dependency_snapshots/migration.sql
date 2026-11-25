-- Suppress legacy dependency cards whose summaries explicitly describe a static task snapshot.
UPDATE "OperationalUpdate"
SET verified = false
WHERE verified AND kind = 'DEPENDENCY_CHANGED'
  AND (summary ~* '^No (task-specific |meaningful |substantive )*(change|progress|work|execution)'
    OR (summary ~* '(remained|remains|still (shows|in)) (in )?To Do'
      AND summary ~* 'no (task-specific|subsequent|recorded|documented|execution)'));
