import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/index";
import { createPlaylist, getVideoByVideoId, insertNewVideos } from "../src/db/queries";

// See test/jobs-sync.test.ts: D1 storage is shared across tests in this
// file, and `videoid`/`youtube_playlist_id` are globally unique.

describe("GET /", () => {
  it("renders subscribed playlists and their videos", async () => {
    const playlist = await createPlaylist(env.DB, {
      youtubePlaylistId: "PLroutes1",
      url: "https://youtube.com/playlist?list=PLroutes1",
      title: "Route Test Playlist",
      channel: "Route Test Channel",
    });
    await insertNewVideos(env.DB, playlist.id, [
      { videoId: "route_v1", title: "Route Video 1", publishedAt: "2026-01-01T00:00:00Z" },
    ]);

    const res = await app.request("/", {}, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Route Test Playlist");
    expect(html).toContain("Route Video 1");
    expect(html).toContain('data-video-id="route_v1"');
  });
});

describe("GET /player.js", () => {
  it("serves the client script as javascript", async () => {
    const res = await app.request("/player.js", {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
    const body = await res.text();
    expect(body).toContain("onYouTubeIframeAPIReady");
  });
});

describe("POST /playlists", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("subscribes to a new playlist and redirects home", async () => {
    fetchSpy.mockImplementation((input: string) => {
      const url = new URL(input);
      if (url.pathname.endsWith("/playlists")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ items: [{ snippet: { title: "New Playlist", channelTitle: "New Channel" } }] }),
            { headers: { "content-type": "application/json" } },
          ),
        );
      }
      return Promise.resolve(new Response(JSON.stringify({ items: [] }), { headers: { "content-type": "application/json" } }));
    });

    const form = new URLSearchParams({ url: "https://youtube.com/playlist?list=PLroutes2" });
    const res = await app.request(
      "/playlists",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      },
      env,
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
  });

  it("rejects a request with no url", async () => {
    const res = await app.request(
      "/playlists",
      { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "" },
      env,
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/progress", () => {
  it("records progress for a known video", async () => {
    const playlist = await createPlaylist(env.DB, {
      youtubePlaylistId: "PLroutes3",
      url: "https://youtube.com/playlist?list=PLroutes3",
      title: "Progress Playlist",
      channel: "Progress Channel",
    });
    await insertNewVideos(env.DB, playlist.id, [
      { videoId: "route_progress_v1", title: "V", publishedAt: "2026-01-01T00:00:00Z" },
    ]);

    const res = await app.request(
      "/api/progress",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ videoId: "route_progress_v1", currentTime: 42, duration: 100 }),
      },
      env,
    );

    expect(res.status).toBe(204);
    const video = await getVideoByVideoId(env.DB, "route_progress_v1");
    expect(video?.progress_seconds).toBe(42);
    expect(video?.duration_seconds).toBe(100);
  });

  it("rejects a malformed payload", async () => {
    const res = await app.request(
      "/api/progress",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ videoId: "x" }) },
      env,
    );
    expect(res.status).toBe(400);
  });
});
