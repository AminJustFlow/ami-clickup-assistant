ALTER TABLE "OperationalUpdate" ADD COLUMN "conversationCitation" JSONB;

-- These three historical fingerprints were traced to one parent comment before
-- citations were captured on updates. Later assessments are independent.
UPDATE "OperationalUpdate" u
SET "conversationCitation" = jsonb_build_object(
  'commentId', c.id, 'author', c."authorName",
  'excerpt', substring(c.body from 'I am reviewing now so please stand by[^?]*promotion subtask level[?]'),
  'at', to_char(c."clickupCreatedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
FROM "Comment" c
WHERE c."clickupCommentId" = '90140285053146'
  AND c.body ~ 'I am reviewing now so please stand by[^?]*promotion subtask level[?]'
  AND u.kind = 'DECISION_REQUESTED'
  AND u."sourceFingerprint" IN (
    '1b08524676177cb5b5e5634fe884f234d429db6b5579079a4e19761578246c8f',
    '45265e2d708ccfc347094433ac87c15c4836b95ef2ef4bba8926a9b6dbbeeeb9',
    '27d7eb3d88d0c33e1fe0f0a3266a20a965ed2c5be0c59b987798a0cf3e1c1c8b');
