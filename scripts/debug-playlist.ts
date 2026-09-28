#!/usr/bin/env tsx
/**
 * Polls a YouTube playlist URL via the Data API and prints what gets
 * parsed, without needing a deployed Worker or D1 at all. Useful for
 * diagnosing "why did a playlist stop picking up new videos" the way the
 * Rails app's scraping approach silently broke for ~4 months — with a
 * documented API instead of scraped HTML, this should mostly be about
 * verifying pagination/field-shape assumptions, not markup archaeology.
 *
 * Usage:
 *   npm run debug:playlist                      # uses the ASOT example below
 *   npm run debug:playlist -- <playlist-url>     # any other playlist
 *
 * Reads YOUTUBE_API_KEY from .dev.vars (same file `wrangler dev` uses) or
 * from the environment.
 */
import { readFileSync } from "node:fs";
import { fetchAllPlaylistItems, fetchPlaylistMetadata, extractPlaylistId } from "../src/youtube/client";

// A State Of Trance Episodes, by Armin van Buuren — the playlist that was
// found (during design) to have silently stopped syncing in the Rails app.
// Handy as a real-world default for exercising pagination (100+ pages).
const EXAMPLE_PLAYLIST_URL = "https://www.youtube.com/playlist?list=PL0cWlOyqP6_PKyS76fDsafkj_ho4KLmEA";

function loadApiKey(): string {
  if (process.env.YOUTUBE_API_KEY) return process.env.YOUTUBE_API_KEY;

  try {
    const devVars = readFileSync(new URL("../.dev.vars", import.meta.url), "utf8");
    const match = devVars.match(/^YOUTUBE_API_KEY=(.+)$/m);
    if (match?.[1]) return match[1].trim();
  } catch {
    // .dev.vars doesn't exist — fall through to the error below.
  }

  console.error(
    "No YOUTUBE_API_KEY found. Set it in the environment, or add it to .dev.vars " +
      "(copy .dev.vars.example and fill in a real key).",
  );
  process.exit(1);
}

async function main() {
  const apiKey = loadApiKey();
  const url = process.argv[2] ?? EXAMPLE_PLAYLIST_URL;
  const playlistId = extractPlaylistId(url);

  console.log(`Playlist URL: ${url}`);
  console.log(`Playlist ID:  ${playlistId}\n`);

  const metadata = await fetchPlaylistMetadata(apiKey, playlistId);
  console.log(`Title:   ${metadata.title}`);
  console.log(`Channel: ${metadata.channel}\n`);

  const items = await fetchAllPlaylistItems(apiKey, playlistId);
  console.log(`Fetched ${items.length} video(s).\n`);

  const sorted = [...items].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  console.log("Most recent 10 (by publishedAt):");
  for (const item of sorted.slice(0, 10)) {
    console.log(`  ${item.publishedAt}  ${item.videoId}  ${item.title}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
