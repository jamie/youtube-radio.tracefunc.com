const API_BASE = "https://www.googleapis.com/youtube/v3";

// Safety cap on pagination for pathologically large playlists. 50 items/page,
// so this is 5000 videos — far beyond anything a personal feed subscribes to.
const MAX_PAGES = 100;

// Hard cap on how far back the crawler will pull: some subscribed playlists
// (uploads playlists in particular) go back to 2014, far beyond anything
// meant to show up in a "new episodes" feed. Nothing published before this
// is ever fetched, for a new subscription or an existing one.
export const MIN_PUBLISHED_AT = "2026-08-01T00:00:00Z";

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
 */
export async function fetchAllPlaylistItems(
  apiKey: string,
  playlistId: string,
): Promise<PlaylistItem[]> {
  const items: PlaylistItem[] = [];
  let pageToken: string | undefined;
  let pages = 0;

  do {
    const data = await youtubeGet(apiKey, "playlistItems", {
      part: "snippet",
      playlistId,
      maxResults: "50",
      ...(pageToken ? { pageToken } : {}),
    });

    for (const item of data.items ?? []) {
      const videoId = item.snippet?.resourceId?.videoId;
      const title = item.snippet?.title;
      const publishedAt = item.snippet?.publishedAt;
      // Deleted/private videos still show up as playlist items but without
      // real snippet data — skip them rather than storing garbage rows.
      if (!videoId || !title || !publishedAt || title === "Deleted video" || title === "Private video") {
        continue;
      }
      // publishedAt is always a full ISO 8601 UTC timestamp, so string
      // comparison against MIN_PUBLISHED_AT sorts correctly.
      if (publishedAt < MIN_PUBLISHED_AT) {
        continue;
      }
      items.push({ videoId, title, publishedAt });
    }

    pageToken = data.nextPageToken;
    pages += 1;
  } while (pageToken && pages < MAX_PAGES);

  return items;
}
