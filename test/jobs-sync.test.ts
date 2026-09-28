import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPlaylist, listVideosForPlaylist } from "../src/db/queries";
import { syncAllPlaylists, syncPlaylist } from "../src/jobs/sync";

// D1 storage is isolated per test FILE, not per test case, and `videoid` is
// globally unique — so every `it()` below needs its own distinct videoIds
// (not just distinct playlist ids) or inserts will silently no-op against
// rows left behind by an earlier test in this file.

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}

function playlistItemsResponse(items: Array<{ videoId: string; title: string; publishedAt: string }>) {
  return jsonResponse({
    items: items.map((item) => ({
      snippet: {
        resourceId: { videoId: item.videoId },
        title: item.title,
        publishedAt: item.publishedAt,
      },
    })),
  });
}

describe("syncPlaylist", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("only inserts videos not already known for the playlist", async () => {
    const playlist = await createPlaylist(env.DB, {
      youtubePlaylistId: "PLsync",
      url: "https://youtube.com/playlist?list=PLsync",
      title: "Test",
      channel: "Test",
    });

    // Seed one video that already exists, as if a previous sync found it.
    fetchSpy.mockResolvedValueOnce(
      playlistItemsResponse([{ videoId: "old", title: "Old", publishedAt: "2026-01-01T00:00:00Z" }]),
    );
    await syncPlaylist(env.DB, "key", playlist);
    fetchSpy.mockClear();

    // Live playlist now has the old video plus a new one.
    fetchSpy.mockResolvedValueOnce(
      playlistItemsResponse([
        { videoId: "old", title: "Old", publishedAt: "2026-01-01T00:00:00Z" },
        { videoId: "new", title: "New", publishedAt: "2026-02-01T00:00:00Z" },
      ]),
    );

    const result = await syncPlaylist(env.DB, "key", playlist);

    expect(result.inserted).toBe(1);
    const videos = await listVideosForPlaylist(env.DB, playlist.id);
    expect(videos.map((v) => v.videoid).sort()).toEqual(["new", "old"]);
  });
});

describe("syncAllPlaylists", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps syncing other playlists when one fails", async () => {
    const good = await createPlaylist(env.DB, {
      youtubePlaylistId: "PLgood",
      url: "https://youtube.com/playlist?list=PLgood",
      title: "Good",
      channel: "Good",
    });
    const bad = await createPlaylist(env.DB, {
      youtubePlaylistId: "PLbad",
      url: "https://youtube.com/playlist?list=PLbad",
      title: "Bad",
      channel: "Bad",
    });

    // Match on the exact playlist being fetched (not just "isn't PLbad") —
    // a leaked row from another test in this file would otherwise also hit
    // whatever the fallback case returns and collide on a shared videoId.
    fetchSpy.mockImplementation((input: string) => {
      const url = new URL(input);
      const playlistId = url.searchParams.get("playlistId");
      if (playlistId === "PLbad") {
        return Promise.resolve(new Response("quota exceeded", { status: 403 }));
      }
      if (playlistId === "PLgood") {
        return Promise.resolve(
          playlistItemsResponse([{ videoId: "good_v1", title: "Good V1", publishedAt: "2026-01-01T00:00:00Z" }]),
        );
      }
      return Promise.resolve(playlistItemsResponse([]));
    });

    const results = await syncAllPlaylists(env.DB, "key");

    const goodResult = results.find((r) => r.playlistId === good.id);
    const badResult = results.find((r) => r.playlistId === bad.id);

    expect(goodResult?.inserted).toBe(1);
    expect(goodResult?.error).toBeUndefined();
    expect(badResult?.inserted).toBe(0);
    expect(badResult?.error).toBeDefined();
  });
});
