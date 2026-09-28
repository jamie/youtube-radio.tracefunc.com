import { deleteVideos, findCleanupEligibleVideos, type VideoRow } from "../db/queries";

const DEFAULT_GRACE_DAYS = 7;

export interface CleanupResult {
  deleted: VideoRow[];
}

/**
 * Hard-deletes any video that's >=95% watched and hasn't had its progress
 * updated in `graceDays` days (see findCleanupEligibleVideos for exact
 * semantics). This is a permanent delete, not a soft-hide — a deliberate
 * simplification decided during design, since old references don't need to
 * be kept around.
 */
export async function runCleanup(db: D1Database, graceDays = DEFAULT_GRACE_DAYS): Promise<CleanupResult> {
  const eligible = await findCleanupEligibleVideos(db, graceDays);
  await deleteVideos(
    db,
    eligible.map((video) => video.id),
  );
  return { deleted: eligible };
}
