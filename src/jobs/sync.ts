import { getExistingVideoIds, insertNewVideos, listPlaylists, type PlaylistRow } from "../db/queries";
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
 */
export async function syncAllPlaylists(db: D1Database, apiKey: string): Promise<SyncResult[]> {
  const playlists = await listPlaylists(db);

  return Promise.all(
    playlists.map(async (playlist) => {
      try {
        return await syncPlaylist(db, apiKey, playlist);
      } catch (error) {
        return {
          playlistId: playlist.id,
          playlistTitle: playlist.title,
          inserted: 0,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
}
