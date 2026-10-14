import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPlaylistById, listVideosForPlaylist } from "../src/db/queries";
import { subscribeToPlaylist, updatePlaylistDetails } from "../src/playlists";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}

describe("subscribeToPlaylist", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("records the playlist and seeds only the 10 most recent videos", async () => {
    fetchSpy.mockImplementation((input: string) => {
      const url = new URL(input);
      if (url.pathname.endsWith("/playlists")) {
        return Promise.resolve(
          jsonResponse({ items: [{ snippet: { title: "ASOT", channelTitle: "Armin van Buuren" } }] }),
        );
      }
      // 15 videos, published one day apart (all after the MIN_PUBLISHED_AT
      // cutoff) — only the newest 10 should be kept.
      const items = Array.from({ length: 15 }, (_, i) => ({
        snippet: {
          resourceId: { videoId: `v${i}` },
          title: `Episode ${i}`,
          publishedAt: new Date(Date.UTC(2026, 7, i + 1)).toISOString(),
        },
      }));
      return Promise.resolve(jsonResponse({ items }));
    });

    const playlist = await subscribeToPlaylist(
      env.DB,
      "key",
      "https://youtube.com/playlist?list=PLxyz",
    );

    expect(playlist.title).toBe("ASOT");
    expect(playlist.channel).toBe("Armin van Buuren");

    const videos = await listVideosForPlaylist(env.DB, playlist.id);
    expect(videos).toHaveLength(10);
    // Newest 10 of 0..14 are 5..14.
    const ids = videos.map((v) => v.videoid).sort();
    expect(ids).toEqual(["v10", "v11", "v12", "v13", "v14", "v5", "v6", "v7", "v8", "v9"]);
  });
});

describe("updatePlaylistDetails", () => {
  it("updates the title and re-derives the youtube playlist id from the new url", async () => {
    const fetchSpy = vi.fn().mockImplementation((input: string) => {
      const url = new URL(input);
      if (url.pathname.endsWith("/playlists")) {
        return Promise.resolve(jsonResponse({ items: [{ snippet: { title: "Old", channelTitle: "Old Channel" } }] }));
      }
      return Promise.resolve(jsonResponse({ items: [] }));
    });
    vi.stubGlobal("fetch", fetchSpy);

    const playlist = await subscribeToPlaylist(env.DB, "key", "https://youtube.com/playlist?list=PLold");

    const updated = await updatePlaylistDetails(env.DB, playlist.id, {
      url: "https://youtube.com/playlist?list=PLnew",
      title: "New Name",
    });

    expect(updated.title).toBe("New Name");
    expect(updated.youtube_playlist_id).toBe("PLnew");

    const fetched = await getPlaylistById(env.DB, playlist.id);
    expect(fetched?.url).toBe("https://youtube.com/playlist?list=PLnew");

    vi.unstubAllGlobals();
  });
});
