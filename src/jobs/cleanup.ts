import { findCleanupEligibleVideos, softDeleteVideos, type VideoRow } from "../db/queries";

const DEFAULT_GRACE_DAYS = 7;

export interface CleanupResult {
  deleted: VideoRow[];
}

/**
 * Soft-deletes any video that's >=95% watched and hasn't had its progress
 * updated in `graceDays` days (see findCleanupEligibleVideos for exact
 * semantics). Soft, not hard: a hard delete would free up the videoid to be
 * mistaken for new and re-inserted on the next sync.
 */
export async function runCleanup(db: D1Database, graceDays = DEFAULT_GRACE_DAYS): Promise<CleanupResult> {
  const eligible = await findCleanupEligibleVideos(db, graceDays);
  await softDeleteVideos(
    db,
    eligible.map((video) => video.id),
  );
  return { deleted: eligible };
}
