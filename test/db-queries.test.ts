import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  createPlaylist,
  findCleanupEligibleVideos,
  getAllExistingVideoIds,
  getExistingVideoIds,
  getPlaylistById,
  getVideoByVideoId,
  insertNewVideos,
  insertNewVideosBatch,
  listVideosForPlaylist,
  recordProgress,
  recordSyncAttemptsBatch,
  softDeleteVideos,
  updatePlaylist,
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

describe("insertNewVideosBatch / getAllExistingVideoIds", () => {
  it("inserts for multiple playlists in one batch and groups existing ids by playlist", async () => {
    const a = await makePlaylist("PL_batch_a");
    const b = await makePlaylist("PL_batch_b");

    const inserted = await insertNewVideosBatch(env.DB, [
      { playlistId: a.id, videoId: "a1", title: "A1", publishedAt: "2026-01-01T00:00:00Z" },
      { playlistId: a.id, videoId: "a2", title: "A2", publishedAt: "2026-01-02T00:00:00Z" },
      { playlistId: b.id, videoId: "b1", title: "B1", publishedAt: "2026-01-01T00:00:00Z" },
    ]);

    expect(inserted.get(a.id)).toBe(2);
    expect(inserted.get(b.id)).toBe(1);

    const existingIds = await getAllExistingVideoIds(env.DB);
    expect(existingIds.get(a.id)).toEqual(new Set(["a1", "a2"]));
    expect(existingIds.get(b.id)).toEqual(new Set(["b1"]));

    // Re-inserting the same ids for the wrong playlist's count must not
    // happen — a repeat batch with one already-known id per playlist
    // should only count the genuinely new one against each.
    const secondInserted = await insertNewVideosBatch(env.DB, [
      { playlistId: a.id, videoId: "a1", title: "A1", publishedAt: "2026-01-01T00:00:00Z" }, // known
      { playlistId: a.id, videoId: "a3", title: "A3", publishedAt: "2026-01-03T00:00:00Z" }, // new
      { playlistId: b.id, videoId: "b1", title: "B1", publishedAt: "2026-01-01T00:00:00Z" }, // known
    ]);
    expect(secondInserted.get(a.id)).toBe(1);
    expect(secondInserted.get(b.id) ?? 0).toBe(0);
  });
});

describe("recordSyncAttemptsBatch", () => {
  it("records each playlist's own outcome, not a shared one", async () => {
    const ok = await makePlaylist("PL_sync_ok");
    const failed = await makePlaylist("PL_sync_failed");

    await recordSyncAttemptsBatch(env.DB, [
      { playlistId: ok.id, error: null },
      { playlistId: failed.id, error: "quota exceeded" },
    ]);

    expect((await getPlaylistById(env.DB, ok.id))?.last_sync_error).toBeNull();
    expect((await getPlaylistById(env.DB, failed.id))?.last_sync_error).toBe("quota exceeded");
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

describe("getPlaylistById / updatePlaylist", () => {
  it("updates the name, url, and derived youtube playlist id", async () => {
    const playlist = await makePlaylist("PL_edit");

    const updated = await updatePlaylist(env.DB, playlist.id, {
      youtubePlaylistId: "PL_edit_new",
      url: "https://youtube.com/playlist?list=PL_edit_new",
      title: "Renamed",
    });

    expect(updated?.title).toBe("Renamed");
    expect(updated?.youtube_playlist_id).toBe("PL_edit_new");

    const fetched = await getPlaylistById(env.DB, playlist.id);
    expect(fetched?.title).toBe("Renamed");
    expect(fetched?.url).toBe("https://youtube.com/playlist?list=PL_edit_new");
  });

  it("returns null for an unknown playlist id", async () => {
    const result = await getPlaylistById(env.DB, 999999);
    expect(result).toBeNull();
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
