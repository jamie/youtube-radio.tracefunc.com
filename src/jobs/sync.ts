import {
  getAllExistingVideoIds,
  getExistingVideoIds,
  insertNewVideos,
  insertNewVideosBatch,
  listPlaylists,
  recordSyncAttemptsBatch,
  type PlaylistRow,
} from "../db/queries";
import { fetchAllPlaylistItems } from "../youtube/client";

export interface SyncResult {
  playlistId: number;
  playlistTitle: string | null;
  inserted: number;
  error?: string;
}

/**
 * Fetches every item currently in the playlist and inserts any videos not
 * already known for it. No ordering assumption is made about the YouTube
 * API response (see youtube/client.ts) — every run just diffs the full
 * remote list against what's already stored.
 */
export async function syncPlaylist(
  db: D1Database,
  apiKey: string,
  playlist: PlaylistRow,
): Promise<SyncResult> {
  const [items, existingIds] = await Promise.all([
    fetchAllPlaylistItems(apiKey, playlist.youtube_playlist_id),
    getExistingVideoIds(db, playlist.id),
  ]);

  const newItems = items.filter((item) => !existingIds.has(item.videoId));
  const inserted = await insertNewVideos(
    db,
    playlist.id,
    newItems.map((item) => ({ videoId: item.videoId, title: item.title, publishedAt: item.publishedAt })),
  );

  return { playlistId: playlist.id, playlistTitle: playlist.title, inserted };
}

/**
 * Syncs every subscribed playlist. One playlist's failure (e.g. a transient
 * YouTube API error) doesn't stop the others from syncing.
 *
 * Deliberately does NOT do this by calling syncPlaylist once per playlist:
 * that was 2-3 D1 subrequests per playlist (existing-ids lookup, insert,
 * sync-attempt record) on top of the YouTube fetch, and with enough
 * subscribed playlists that total reliably exceeded the Worker's
 * per-invocation subrequest limit partway through — which playlists made it
 * in before the limit tripped varied run to run, so syncs appeared to
 * "randomly" succeed for a handful of playlists and silently fail for the
 * rest. Batching the D1 side across all playlists into 3 calls total
 * (regardless of playlist count) keeps the subrequest count to roughly N
 * YouTube fetches + 3, not 3N+.
 */
export async function syncAllPlaylists(db: D1Database, apiKey: string): Promise<SyncResult[]> {
  const [playlists, existingIdsByPlaylist] = await Promise.all([listPlaylists(db), getAllExistingVideoIds(db)]);

  const fetches = await Promise.all(
    playlists.map(async (playlist) => {
      try {
        const items = await fetchAllPlaylistItems(apiKey, playlist.youtube_playlist_id);
        return { playlist, items, error: null as string | null };
      } catch (error) {
        return { playlist, items: [], error: error instanceof Error ? error.message : String(error) };
      }
    }),
  );

  const newVideos = fetches.flatMap(({ playlist, items, error }) => {
    if (error) return [];
    const existingIds = existingIdsByPlaylist.get(playlist.id) ?? new Set<string>();
    return items
      .filter((item) => !existingIds.has(item.videoId))
      .map((item) => ({
        playlistId: playlist.id,
        videoId: item.videoId,
        title: item.title,
        publishedAt: item.publishedAt,
      }));
  });

  const [insertedByPlaylist] = await Promise.all([
    insertNewVideosBatch(db, newVideos),
    recordSyncAttemptsBatch(
      db,
      fetches.map(({ playlist, error }) => ({ playlistId: playlist.id, error })),
    ),
  ]);

  return fetches.map(({ playlist, error }) => ({
    playlistId: playlist.id,
    playlistTitle: playlist.title,
    inserted: insertedByPlaylist.get(playlist.id) ?? 0,
    error: error ?? undefined,
  }));
}
