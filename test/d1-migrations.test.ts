import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("D1 migrations", () => {
  it("creates the playlists and videos tables", async () => {
    const tables = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all();
    const names = tables.results.map((row: any) => row.name);
    expect(names).toEqual(expect.arrayContaining(["playlists", "videos"]));
  });

  it("round-trips a playlist row", async () => {
    await env.DB.prepare(
      "INSERT INTO playlists (youtube_playlist_id, url, title, channel) VALUES (?, ?, ?, ?)",
    )
      .bind("PLxyz", "https://youtube.com/playlist?list=PLxyz", "Test Playlist", "Test Channel")
      .run();

    const row = await env.DB.prepare("SELECT * FROM playlists WHERE youtube_playlist_id = ?")
      .bind("PLxyz")
      .first();

    expect(row).toMatchObject({ title: "Test Playlist", channel: "Test Channel" });
  });
});
