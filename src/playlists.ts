import { createPlaylist, insertNewVideos, type PlaylistRow } from "./db/queries";
import { extractPlaylistId, fetchAllPlaylistItems, fetchPlaylistMetadata } from "./youtube/client";

// Matches the Rails app's PlaylistUpdateVideosJob behavior for a brand new
// subscription: seed it with the most recent 10 videos rather than the
// playlist's entire history.
const INITIAL_VIDEO_COUNT = 10;

/**
 * Subscribes to a new playlist: records it, then seeds it with the most
 * recent INITIAL_VIDEO_COUNT videos (by publishedAt — the YouTube API's
 * item order isn't assumed to mean anything, so we always fetch everything
 * and sort ourselves; see youtube/client.ts).
 */
export async function subscribeToPlaylist(
  db: D1Database,
  apiKey: string,
  url: string,
): Promise<PlaylistRow> {
  const youtubePlaylistId = extractPlaylistId(url);
  const metadata = await fetchPlaylistMetadata(apiKey, youtubePlaylistId);

  const playlist = await createPlaylist(db, {
    youtubePlaylistId,
    url,
    title: metadata.title,
    channel: metadata.channel,
  });

  const items = await fetchAllPlaylistItems(apiKey, youtubePlaylistId);
  const mostRecent = [...items]
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, INITIAL_VIDEO_COUNT);

  await insertNewVideos(
    db,
    playlist.id,
    mostRecent.map((item) => ({ videoId: item.videoId, title: item.title, publishedAt: item.publishedAt })),
  );

  return playlist;
}
