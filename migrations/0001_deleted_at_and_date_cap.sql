-- Migration number: 0001 	 2026-09-29T02:30:00.000Z
-- Two related changes:
--
-- 1. Soft-delete support. The cleanup job used to hard-delete watched videos,
--    but that gave the sync job nothing to distinguish "never seen" from
--    "seen and deliberately pruned" — a hard-deleted video's id disappears
--    from the known-ids set, so the next sync sees it as new again and
--    re-inserts it. deleted_at fixes that: pruning sets it instead of
--    removing the row, so the row (and its videoid) is still present for
--    getExistingVideoIds to dedupe against, while listing queries filter
--    deleted_at IS NULL so it no longer shows up.
--
-- 2. Retroactively enforce the new MIN_PUBLISHED_AT cutoff (see
--    youtube/client.ts) — the crawler had been pulling videos back to 2014.

ALTER TABLE videos ADD COLUMN deleted_at TEXT;
CREATE INDEX idx_videos_deleted_at ON videos(deleted_at);

DELETE FROM videos WHERE published_at < '2026-08-01T00:00:00Z';
