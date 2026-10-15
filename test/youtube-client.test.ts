import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  extractPlaylistId,
  fetchAllPlaylistItems,
  fetchPlaylistMetadata,
  minPublishedAt,
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

describe("minPublishedAt", () => {
  it("is 30 days before now, formatted like the API's publishedAt", () => {
    expect(minPublishedAt(new Date("2026-10-15T12:34:56.789Z"))).toBe("2026-09-15T12:34:56Z");
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

  it("skips videos published before the rolling cutoff", async () => {
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
              publishedAt: minPublishedAt(),
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

  it("stops paginating once a page has nothing new to offer", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        nextPageToken: "page2",
        items: [
          {
            snippet: {
              resourceId: { videoId: "known1" },
              title: "Already synced",
              publishedAt: "2026-08-01T00:00:00Z",
            },
          },
        ],
      }),
    );

    const items = await fetchAllPlaylistItems("key", "PLxyz", new Set(["known1"]));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(items).toEqual([
      { videoId: "known1", title: "Already synced", publishedAt: "2026-08-01T00:00:00Z" },
    ]);
  });

  it("keeps paginating while a page still has unknown videos", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        jsonResponse({
          nextPageToken: "page2",
          items: [
            {
              snippet: {
                resourceId: { videoId: "known1" },
                title: "Already synced",
                publishedAt: "2026-08-01T00:00:00Z",
              },
            },
            {
              snippet: {
                resourceId: { videoId: "new1" },
                title: "Brand new episode",
                publishedAt: "2026-08-02T00:00:00Z",
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
                resourceId: { videoId: "known2" },
                title: "Already synced too",
                publishedAt: "2026-08-03T00:00:00Z",
              },
            },
          ],
        }),
      );

    const items = await fetchAllPlaylistItems("key", "PLxyz", new Set(["known1", "known2"]));

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(items.map((item) => item.videoId)).toEqual(["known1", "new1", "known2"]);
  });

  it("doesn't count pre-cutoff videos as new when deciding whether to keep paginating", async () => {
    // Mirrors real long-running shows: page 1 has recent episodes mixed in
    // with years-old back catalog that is never stored, so it's never "known".
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        nextPageToken: "page2",
        items: [
          {
            snippet: {
              resourceId: { videoId: "known1" },
              title: "Already synced",
              publishedAt: "2026-08-01T00:00:00Z",
            },
          },
          {
            snippet: {
              resourceId: { videoId: "ancient" },
              title: "Back catalog",
              publishedAt: "2019-03-01T00:00:00Z",
            },
          },
        ],
      }),
    );

    const items = await fetchAllPlaylistItems("key", "PLxyz", new Set(["known1"]));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(items.map((item) => item.videoId)).toEqual(["known1"]);
  });

  it("stops after a page of only pre-cutoff videos even on a first sync", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        jsonResponse({
          nextPageToken: "page2",
          items: [
            {
              snippet: {
                resourceId: { videoId: "new1" },
                title: "Brand new episode",
                publishedAt: "2026-09-01T00:00:00Z",
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          nextPageToken: "page3",
          items: [
            {
              snippet: {
                resourceId: { videoId: "ancient" },
                title: "Back catalog",
                publishedAt: "2019-03-01T00:00:00Z",
              },
            },
          ],
        }),
      );

    const items = await fetchAllPlaylistItems("key", "PLxyz");

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(items.map((item) => item.videoId)).toEqual(["new1"]);
  });
});
