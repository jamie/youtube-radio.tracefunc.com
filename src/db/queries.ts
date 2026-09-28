export interface PlaylistRow {
  id: number;
  youtube_playlist_id: string;
  url: string;
  title: string | null;
  channel: string | null;
  created_at: string;
}

export interface VideoRow {
  id: number;
  playlist_id: number;
  videoid: string;
  title: string;
  published_at: string;
  duration_seconds: number | null;
  progress_seconds: number;
  last_watched_at: string | null;
  created_at: string;
}

export interface NewPlaylist {
  youtubePlaylistId: string;
  url: string;
  title: string;
  channel: string;
}

export interface NewVideo {
  videoId: string;
  title: string;
  publishedAt: string;
}

export async function createPlaylist(db: D1Database, playlist: NewPlaylist): Promise<PlaylistRow> {
  const row = await db
    .prepare(
      `INSERT INTO playlists (youtube_playlist_id, url, title, channel)
       VALUES (?, ?, ?, ?)
       RETURNING *`,
    )
    .bind(playlist.youtubePlaylistId, playlist.url, playlist.title, playlist.channel)
    .first<PlaylistRow>();
  if (!row) throw new Error("Failed to create playlist");
  return row;
}

export async function listPlaylists(db: D1Database): Promise<PlaylistRow[]> {
  const result = await db.prepare("SELECT * FROM playlists ORDER BY created_at ASC").all<PlaylistRow>();
  return result.results;
}

export async function listVideosForPlaylist(db: D1Database, playlistId: number): Promise<VideoRow[]> {
  const result = await db
    .prepare("SELECT * FROM videos WHERE playlist_id = ? ORDER BY published_at ASC")
    .bind(playlistId)
    .all<VideoRow>();
  return result.results;
}

export interface PlaylistWithVideos extends PlaylistRow {
  videos: VideoRow[];
}

export async function listPlaylistsWithVideos(db: D1Database): Promise<PlaylistWithVideos[]> {
  const playlists = await listPlaylists(db);
  return Promise.all(
    playlists.map(async (playlist) => ({
      ...playlist,
      videos: await listVideosForPlaylist(db, playlist.id),
    })),
  );
}

export async function getExistingVideoIds(db: D1Database, playlistId: number): Promise<Set<string>> {
  const result = await db
    .prepare("SELECT videoid FROM videos WHERE playlist_id = ?")
    .bind(playlistId)
    .all<{ videoid: string }>();
  return new Set(result.results.map((row) => row.videoid));
}

/**
 * Inserts any videos not already present for this playlist. Uses INSERT OR
 * IGNORE (keyed on the unique `videoid` column) rather than trusting the
 * caller's diff alone, so a race between two syncs can't produce duplicates
 * or crash on a unique-constraint violation.
 */
export async function insertNewVideos(
  db: D1Database,
  playlistId: number,
  videos: NewVideo[],
): Promise<number> {
  if (videos.length === 0) return 0;

  const statements = videos.map((video) =>
    db
      .prepare(
        `INSERT OR IGNORE INTO videos (playlist_id, videoid, title, published_at)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(playlistId, video.videoId, video.title, video.publishedAt),
  );
  const results = await db.batch(statements);
  return results.reduce((count, result) => count + (result.meta.changes ?? 0), 0);
}

export async function getVideoByVideoId(db: D1Database, videoId: string): Promise<VideoRow | null> {
  return db.prepare("SELECT * FROM videos WHERE videoid = ?").bind(videoId).first<VideoRow>();
}

export async function recordProgress(
  db: D1Database,
  videoId: string,
  progress: { progressSeconds: number; durationSeconds: number },
): Promise<void> {
  await db
    .prepare(
      `UPDATE videos
       SET progress_seconds = ?, duration_seconds = ?, last_watched_at = datetime('now')
       WHERE videoid = ?`,
    )
    .bind(progress.progressSeconds, progress.durationSeconds, videoId)
    .run();
}

const CLEANUP_PROGRESS_THRESHOLD = 0.95;

/**
 * Videos eligible for cleanup: at least 95% watched, and at least
 * `graceDays` since the last progress update. The clock is measured from
 * `last_watched_at` (not from when the video first crossed 95%) so that an
 * idle-but-occasionally-rewatched video keeps resetting it and never gets
 * swept — a deliberate choice, not an oversight.
 */
export async function findCleanupEligibleVideos(
  db: D1Database,
  graceDays: number,
): Promise<VideoRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM videos
       WHERE duration_seconds IS NOT NULL
         AND duration_seconds > 0
         AND progress_seconds >= duration_seconds * ?
         AND last_watched_at IS NOT NULL
         AND last_watched_at <= datetime('now', ?)`,
    )
    .bind(CLEANUP_PROGRESS_THRESHOLD, `-${graceDays} days`)
    .all<VideoRow>();
  return result.results;
}

export async function deleteVideos(db: D1Database, ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => "?").join(", ");
  await db
    .prepare(`DELETE FROM videos WHERE id IN (${placeholders})`)
    .bind(...ids)
    .run();
}
