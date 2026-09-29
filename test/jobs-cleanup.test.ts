import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createPlaylist, getVideoByVideoId, insertNewVideos, listVideosForPlaylist } from "../src/db/queries";
import { runCleanup } from "../src/jobs/cleanup";

describe("runCleanup", () => {
  it("soft-deletes only videos past the grace period and reports what it deleted", async () => {
    const playlist = await createPlaylist(env.DB, {
      youtubePlaylistId: "PLcleanup",
      url: "https://youtube.com/playlist?list=PLcleanup",
      title: "Test",
      channel: "Test",
    });
    await insertNewVideos(env.DB, playlist.id, [
      { videoId: "done", title: "Done", publishedAt: "2026-01-01T00:00:00Z" },
      { videoId: "in_progress", title: "In progress", publishedAt: "2026-01-01T00:00:00Z" },
    ]);

    await env.DB.prepare(
      `UPDATE videos SET progress_seconds = 99, duration_seconds = 100,
       last_watched_at = datetime('now', '-10 days') WHERE videoid = 'done'`,
    ).run();
    await env.DB.prepare(
      `UPDATE videos SET progress_seconds = 40, duration_seconds = 100,
       last_watched_at = datetime('now', '-10 days') WHERE videoid = 'in_progress'`,
    ).run();

    const result = await runCleanup(env.DB, 7);

    expect(result.deleted.map((v) => v.videoid)).toEqual(["done"]);
    expect((await getVideoByVideoId(env.DB, "done"))?.deleted_at).not.toBeNull();
    expect((await getVideoByVideoId(env.DB, "in_progress"))?.deleted_at).toBeNull();

    const videos = await listVideosForPlaylist(env.DB, playlist.id);
    expect(videos.map((v) => v.videoid)).toEqual(["in_progress"]);
  });
});
