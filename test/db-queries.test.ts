import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  createPlaylist,
  findCleanupEligibleVideos,
  getExistingVideoIds,
  getVideoByVideoId,
  insertNewVideos,
  listVideosForPlaylist,
  recordProgress,
  softDeleteVideos,
} from "../src/db/queries";

async function makePlaylist(youtubePlaylistId: string) {
  return createPlaylist(env.DB, {
    youtubePlaylistId,
    url: `https://youtube.com/playlist?list=${youtubePlaylistId}`,
    title: "Test Playlist",
    channel: "Test Channel",
  });
}

describe("insertNewVideos / getExistingVideoIds", () => {
  it("inserts new videos and ignores ones already present", async () => {
    const playlist = await makePlaylist("PL_insert");

    await insertNewVideos(env.DB, playlist.id, [
      { videoId: "v1", title: "Episode 1", publishedAt: "2026-01-01T00:00:00Z" },
      { videoId: "v2", title: "Episode 2", publishedAt: "2026-02-01T00:00:00Z" },
    ]);

    const insertedOnSecondSync = await insertNewVideos(env.DB, playlist.id, [
      { videoId: "v2", title: "Episode 2", publishedAt: "2026-02-01T00:00:00Z" }, // already known
      { videoId: "v3", title: "Episode 3", publishedAt: "2026-03-01T00:00:00Z" }, // new
    ]);

    expect(insertedOnSecondSync).toBe(1);

    const ids = await getExistingVideoIds(env.DB, playlist.id);
    expect(ids).toEqual(new Set(["v1", "v2", "v3"]));

    const videos = await listVideosForPlaylist(env.DB, playlist.id);
    expect(videos.map((v) => v.videoid)).toEqual(["v1", "v2", "v3"]);
  });
});

describe("recordProgress", () => {
  it("updates progress, duration, and last_watched_at", async () => {
    const playlist = await makePlaylist("PL_progress");
    await insertNewVideos(env.DB, playlist.id, [
      { videoId: "v1", title: "Episode 1", publishedAt: "2026-01-01T00:00:00Z" },
    ]);

    await recordProgress(env.DB, "v1", { progressSeconds: 42, durationSeconds: 100 });

    const video = await getVideoByVideoId(env.DB, "v1");
    expect(video?.progress_seconds).toBe(42);
    expect(video?.duration_seconds).toBe(100);
    expect(video?.last_watched_at).not.toBeNull();
  });
});

describe("findCleanupEligibleVideos", () => {
  it("only returns videos >=95% watched AND last updated more than the grace period ago", async () => {
    const playlist = await makePlaylist("PL_cleanup");
    await insertNewVideos(env.DB, playlist.id, [
      { videoId: "stale_done", title: "Stale, done", publishedAt: "2026-01-01T00:00:00Z" },
      { videoId: "fresh_done", title: "Fresh, done", publishedAt: "2026-01-01T00:00:00Z" },
      { videoId: "stale_partial", title: "Stale, partial", publishedAt: "2026-01-01T00:00:00Z" },
      { videoId: "never_watched", title: "Never watched", publishedAt: "2026-01-01T00:00:00Z" },
    ]);

    // >=95% watched, last touched 10 days ago -> eligible
    await env.DB.prepare(
      `UPDATE videos SET progress_seconds = 96, duration_seconds = 100,
       last_watched_at = datetime('now', '-10 days') WHERE videoid = 'stale_done'`,
    ).run();

    // >=95% watched, last touched 1 hour ago -> not eligible yet (grace period)
    await env.DB.prepare(
      `UPDATE videos SET progress_seconds = 96, duration_seconds = 100,
       last_watched_at = datetime('now', '-1 hours') WHERE videoid = 'fresh_done'`,
    ).run();

    // Stale but only 50% watched -> never eligible regardless of age
    await env.DB.prepare(
      `UPDATE videos SET progress_seconds = 50, duration_seconds = 100,
       last_watched_at = datetime('now', '-30 days') WHERE videoid = 'stale_partial'`,
    ).run();
    // never_watched: duration_seconds/last_watched_at stay NULL from insert.

    const eligible = await findCleanupEligibleVideos(env.DB, 7);

    expect(eligible.map((v) => v.videoid)).toEqual(["stale_done"]);
  });

  it("rewatching a finished video resets the grace-period clock", async () => {
    const playlist = await makePlaylist("PL_rewatch");
    await insertNewVideos(env.DB, playlist.id, [
      { videoId: "rewatched", title: "Rewatched", publishedAt: "2026-01-01T00:00:00Z" },
    ]);

    // First finished 30 days ago...
    await env.DB.prepare(
      `UPDATE videos SET progress_seconds = 96, duration_seconds = 100,
       last_watched_at = datetime('now', '-30 days') WHERE videoid = 'rewatched'`,
    ).run();

    let eligible = await findCleanupEligibleVideos(env.DB, 7);
    expect(eligible.map((v) => v.videoid)).toContain("rewatched");

    // ...but was glanced at again yesterday, bumping last_watched_at.
    await recordProgress(env.DB, "rewatched", { progressSeconds: 96, durationSeconds: 100 });

    eligible = await findCleanupEligibleVideos(env.DB, 7);
    expect(eligible.map((v) => v.videoid)).not.toContain("rewatched");
  });
});

describe("softDeleteVideos", () => {
  it("sets deleted_at rather than removing the row, and hides it from listings", async () => {
    const playlist = await makePlaylist("PL_delete");
    await insertNewVideos(env.DB, playlist.id, [
      { videoId: "keep", title: "Keep", publishedAt: "2026-01-01T00:00:00Z" },
      { videoId: "remove", title: "Remove", publishedAt: "2026-01-01T00:00:00Z" },
    ]);
    const toRemove = await getVideoByVideoId(env.DB, "remove");

    await softDeleteVideos(env.DB, [toRemove!.id]);

    const removed = await getVideoByVideoId(env.DB, "remove");
    expect(removed?.deleted_at).not.toBeNull();

    const videos = await listVideosForPlaylist(env.DB, playlist.id);
    expect(videos.map((v) => v.videoid)).toEqual(["keep"]);

    // The videoid stays known so a future sync can't mistake it for new.
    const existingIds = await getExistingVideoIds(env.DB, playlist.id);
    expect(existingIds).toContain("remove");
  });
});
