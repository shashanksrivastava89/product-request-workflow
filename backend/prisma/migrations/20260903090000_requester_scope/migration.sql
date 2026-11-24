-- A person belongs to as many teams as they have requester rows.
--
-- `requesters.userId` was unique, so a User could own at most one requester row. That is wrong: on
-- UAT 38 people hold two or three rows (one per team), which is exactly why a requester whose single
-- `users.requesterGroupId` pointed at one team saw an empty, greyed-out team dropdown in every other
-- business unit. Dropping the uniqueness lets the link express reality.
--
-- Prisma may have created this as a unique index rather than a table constraint depending on the
-- generation that applied it, so both are dropped defensively; neither is guaranteed to exist.
ALTER TABLE "requesters" DROP CONSTRAINT IF EXISTS "requesters_userId_key";
DROP INDEX IF EXISTS "requesters_userId_key";

-- The plain lookup index stays (it is what the scope query reads).
CREATE INDEX IF NOT EXISTS "requesters_userId_idx" ON "requesters" ("userId");

-- Backfill the link where a requester row unambiguously belongs to one account, comparing on a
-- normalised name (ideographic space folded, whitespace collapsed, upper-cased) the same way the
-- application does. Rows already linked are left alone, and a name that resolves to more than one
-- account is skipped rather than guessed.
UPDATE "requesters" r
SET    "userId" = m.user_id
FROM (
  SELECT  norm.n              AS n,
          MIN(u.id::text)::text AS user_id
  FROM   (SELECT DISTINCT upper(regexp_replace(replace(name, U&'\3000', ' '), '\s+', ' ', 'g')) AS n
          FROM "requesters") norm
  JOIN   "users" u
    ON   upper(regexp_replace(replace(u.name, U&'\3000', ' '), '\s+', ' ', 'g')) = norm.n
  GROUP BY norm.n
  HAVING COUNT(DISTINCT u.id) = 1
) m
WHERE  r."userId" IS NULL
  AND  upper(regexp_replace(replace(r.name, U&'\3000', ' '), '\s+', ' ', 'g')) = m.n;
