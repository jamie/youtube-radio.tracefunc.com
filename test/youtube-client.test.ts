import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  extractPlaylistId,
  fetchAllPlaylistItems,
  fetchPlaylistMetadata,
  MIN_PUBLISHED_AT,
  YouTubeApiError,
} from "../src/youtube/client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("extractPlaylistId", () => {
  it("pulls the list param out of a playlist URL", () => {
    expect(
      extractPlaylistId(
        "https://www.youtube.com/playlist?list=PL0cWlOyqP6_PKyS76fDsafkj_ho4KLmEA",
      ),
    ).toBe("PL0cWlOyqP6_PKyS76fDsafkj_ho4KLmEA");
  });

  it("throws when there is no list param", () => {
    expect(() => extractPlaylistId("https://www.youtube.com/watch?v=abc")).toThrow();
  });
});

describe("fetchPlaylistMetadata", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns title and channel from the API response", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        items: [{ snippet: { title: "A State Of Trance Episodes", channelTitle: "Armin van Buuren" } }],
      }),
    );

    const result = await fetchPlaylistMetadata("key", "PLxyz");

    expect(result).toEqual({ title: "A State Of Trance Episodes", channel: "Armin van Buuren" });
    const calledUrl = new URL(fetchSpy.mock.calls[0]![0] as string);
    expect(calledUrl.pathname).toBe("/youtube/v3/playlists");
    expect(calledUrl.searchParams.get("id")).toBe("PLxyz");
    expect(calledUrl.searchParams.get("key")).toBe("key");
  });

  it("throws when the playlist doesn't exist", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ items: [] }));
    await expect(fetchPlaylistMetadata("key", "missing")).rejects.toThrow(/not found/);
  });

  it("throws YouTubeApiError on a non-ok response", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("nope", { status: 403 }));
    await expect(fetchPlaylistMetadata("key", "PLxyz")).rejects.toBeInstanceOf(YouTubeApiError);
  });
});

describe("fetchAllPlaylistItems", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("follows pageToken across multiple pages", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        jsonResponse({
          nextPageToken: "page2",
          items: [
            {
              snippet: {
                resourceId: { videoId: "v1" },
                title: "Episode 1",
                publishedAt: "2026-08-01T00:00:00Z",
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              snippet: {
                resourceId: { videoId: "v2" },
                title: "Episode 2",
                publishedAt: "2026-08-15T00:00:00Z",
              },
            },
          ],
        }),
      );

    const items = await fetchAllPlaylistItems("key", "PLxyz");

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const secondCallUrl = new URL(fetchSpy.mock.calls[1]![0] as string);
    expect(secondCallUrl.searchParams.get("pageToken")).toBe("page2");
    expect(items).toEqual([
      { videoId: "v1", title: "Episode 1", publishedAt: "2026-08-01T00:00:00Z" },
      { videoId: "v2", title: "Episode 2", publishedAt: "2026-08-15T00:00:00Z" },
    ]);
  });

  it("skips deleted/private videos and entries missing required fields", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        items: [
          {
            snippet: {
              resourceId: { videoId: "v1" },
              title: "Deleted video",
              publishedAt: "2026-08-01T00:00:00Z",
            },
          },
          {
            snippet: {
              resourceId: { videoId: "v2" },
              title: "Private video",
              publishedAt: "2026-08-01T00:00:00Z",
            },
          },
          {
            snippet: {
              resourceId: {},
              title: "Missing video id",
              publishedAt: "2026-08-01T00:00:00Z",
            },
          },
          {
            snippet: {
              resourceId: { videoId: "v4" },
              title: "A real episode",
              publishedAt: "2026-08-01T00:00:00Z",
            },
          },
        ],
      }),
    );

    const items = await fetchAllPlaylistItems("key", "PLxyz");

    expect(items).toEqual([
      { videoId: "v4", title: "A real episode", publishedAt: "2026-08-01T00:00:00Z" },
    ]);
  });

  it("skips videos published before MIN_PUBLISHED_AT", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        items: [
          {
            snippet: {
              resourceId: { videoId: "old" },
              title: "Old episode",
              publishedAt: "2014-03-01T00:00:00Z",
            },
          },
          {
            snippet: {
              resourceId: { videoId: "borderline" },
              title: "Right on the cutoff",
              publishedAt: MIN_PUBLISHED_AT,
            },
          },
          {
            snippet: {
              resourceId: { videoId: "new" },
              title: "New episode",
              publishedAt: "2026-08-15T00:00:00Z",
            },
          },
        ],
      }),
    );

    const items = await fetchAllPlaylistItems("key", "PLxyz");

    expect(items.map((item) => item.videoId)).toEqual(["borderline", "new"]);
  });
});
