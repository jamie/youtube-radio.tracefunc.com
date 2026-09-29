import { describe, expect, it } from "vitest";
import { buildWeekColumns, groupVideosByWeek, weekKey, type PlaylistWithVideos } from "../src/grid";
import type { VideoRow } from "../src/db/queries";

function video(overrides: Partial<VideoRow>): VideoRow {
  return {
    id: 1,
    playlist_id: 1,
    videoid: "v1",
    title: "Video",
    published_at: "2026-01-01T00:00:00Z",
    duration_seconds: null,
    progress_seconds: 0,
    last_watched_at: null,
    created_at: "2026-01-01T00:00:00Z",
    deleted_at: null,
    ...overrides,
  };
}

describe("weekKey", () => {
  it("returns the Monday of the containing week, in UTC", () => {
    // 2026-01-01 is a Thursday.
    expect(weekKey("2026-01-01T12:00:00Z")).toBe("2025-12-29");
    // A Monday should map to itself.
    expect(weekKey("2025-12-29T00:00:00Z")).toBe("2025-12-29");
    // A Sunday belongs to the week that started the previous Monday.
    expect(weekKey("2026-01-04T23:59:00Z")).toBe("2025-12-29");
  });
});

describe("buildWeekColumns / groupVideosByWeek", () => {
  it("collects distinct sorted week columns across playlists and groups videos into them", () => {
    const playlists: PlaylistWithVideos[] = [
      {
        id: 1,
        youtube_playlist_id: "PL1",
        url: "u1",
        title: "P1",
        channel: "C1",
        created_at: "x",
        videos: [
          video({ id: 1, videoid: "a", published_at: "2026-01-01T00:00:00Z" }),
          video({ id: 2, videoid: "b", published_at: "2026-01-02T00:00:00Z" }),
        ],
      },
      {
        id: 2,
        youtube_playlist_id: "PL2",
        url: "u2",
        title: "P2",
        channel: "C2",
        created_at: "x",
        videos: [video({ id: 3, videoid: "c", published_at: "2026-01-15T00:00:00Z" })],
      },
    ];

    const columns = buildWeekColumns(playlists);
    expect(columns).toEqual(["2025-12-29", "2026-01-12"]);

    const grouped = groupVideosByWeek(playlists[0]!);
    expect(grouped.get("2025-12-29")?.map((v) => v.videoid)).toEqual(["a", "b"]);
    expect(grouped.has("2026-01-12")).toBe(false);
  });
});
