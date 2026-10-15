const API_BASE = "https://www.googleapis.com/youtube/v3";

// Safety cap on pagination for pathologically large playlists. 50 items/page,
// so this is 5000 videos — far beyond anything a personal feed subscribes to.
const MAX_PAGES = 100;

// Rolling cap on how far back the crawler will pull: some subscribed
// playlists (uploads playlists in particular) go back to 2014, far beyond
// anything meant to show up in a "new episodes" feed. Nothing published more
// than this many days ago is ever fetched, for a new subscription or an
// existing one.
export const PUBLISHED_WINDOW_DAYS = 30;

/**
 * The cutoff timestamp for PUBLISHED_WINDOW_DAYS, formatted like the API's
 * publishedAt (ISO 8601 UTC, no milliseconds) so the two compare correctly
 * as strings.
 */
export function minPublishedAt(now: Date = new Date()): string {
  const cutoff = new Date(now.getTime() - PUBLISHED_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return cutoff.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export class YouTubeApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "YouTubeApiError";
  }
}

export interface PlaylistMetadata {
  title: string;
  channel: string;
}

export interface PlaylistItem {
  videoId: string;
  title: string;
  publishedAt: string;
}

/**
 * Extracts the `list` query param (the playlist ID) from a YouTube playlist URL.
 * Throws if the URL doesn't look like a playlist URL.
 */
export function extractPlaylistId(url: string): string {
  const parsed = new URL(url);
  const playlistId = parsed.searchParams.get("list");
  if (!playlistId) {
    throw new Error(`URL has no "list" query param: ${url}`);
  }
  return playlistId;
}

async function youtubeGet(
  apiKey: string,
  path: string,
  params: Record<string, string>,
): Promise<any> {
  const url = new URL(`${API_BASE}/${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("key", apiKey);

  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text();
    throw new YouTubeApiError(
      `YouTube API request to ${path} failed: ${response.status}`,
      response.status,
      body,
    );
  }
  return response.json();
}

export async function fetchPlaylistMetadata(
  apiKey: string,
  playlistId: string,
): Promise<PlaylistMetadata> {
  const data = await youtubeGet(apiKey, "playlists", {
    part: "snippet",
    id: playlistId,
  });

  const snippet = data.items?.[0]?.snippet;
  if (!snippet) {
    throw new Error(`Playlist not found: ${playlistId}`);
  }

  return {
    title: snippet.title,
    channel: snippet.channelTitle,
  };
}

/**
 * Fetches every item in a playlist, paginating as needed. Deliberately does
 * not assume any particular ordering (newest-first vs. oldest-first is not
 * documented behavior for a channel's uploads playlist) — callers that need
 * "most recent N" should sort the result themselves by `publishedAt`.
 *
 * `knownVideoIds` lets a caller short-circuit pagination once nothing new
 * turns up: for a long-running weekly show (hundreds of episodes, a dozen+
 * pages), re-walking the entire back catalog on every sync just to filter
 * almost all of it out by date was blowing the Worker's per-invocation
 * subrequest limit. Pagination stops after the first page with no "new"
 * video — one that's both unknown AND on/after minPublishedAt(). Pre-cutoff
 * videos must not count as new: they're never stored, so they're never in
 * `knownVideoIds`, and counting them kept every long-running show walking
 * its entire history (every subscribed playlist mixes recent episodes with
 * years of back catalog on page 1). In practice every subscribed playlist
 * adds new episodes at the top, so this is 1-2 pages per playlist; a first
 * sync still backfills until it reaches a page with nothing in the window.
 */
export async function fetchAllPlaylistItems(
  apiKey: string,
  playlistId: string,
  knownVideoIds: Set<string> = new Set(),
): Promise<PlaylistItem[]> {
  const items: PlaylistItem[] = [];
  const cutoff = minPublishedAt();
  let pageToken: string | undefined;
  let pages = 0;

  do {
    const data = await youtubeGet(apiKey, "playlistItems", {
      part: "snippet",
      playlistId,
      maxResults: "50",
      ...(pageToken ? { pageToken } : {}),
    });

    const pageItems: unknown[] = data.items ?? [];
    let sawNewVideo = false;

    for (const item of pageItems) {
      const snippet = (item as { snippet?: Record<string, unknown> }).snippet;
      const videoId = (snippet?.resourceId as { videoId?: string } | undefined)?.videoId;
      const title = snippet?.title as string | undefined;
      const publishedAt = snippet?.publishedAt as string | undefined;
      // Deleted/private videos still show up as playlist items but without
      // real snippet data — skip them rather than storing garbage rows.
      if (!videoId || !title || !publishedAt || title === "Deleted video" || title === "Private video") {
        continue;
      }
      // publishedAt is always a full ISO 8601 UTC timestamp, so string
      // comparison against the cutoff sorts correctly.
      if (publishedAt < cutoff) {
        continue;
      }
      if (!knownVideoIds.has(videoId)) {
        sawNewVideo = true;
      }
      items.push({ videoId, title, publishedAt });
    }

    pageToken = data.nextPageToken;
    pages += 1;

    if (pageItems.length > 0 && !sawNewVideo) break;
  } while (pageToken && pages < MAX_PAGES);

  console.log(`playlistItems ${playlistId}: fetched ${pages} page(s), ${items.length} item(s) in window`);
  return items;
}
