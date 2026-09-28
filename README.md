# youtube-feed — Cloudflare Worker rewrite (WIP)

A from-scratch rewrite of the Rails app to run natively as a Cloudflare
Worker: a YouTube `<iframe>` embed instead of yt-dlp + Plex, watch progress
tracked in D1 instead of polled from Plex, and playlist syncing via the
official YouTube Data API instead of HTML scraping.

This is an independent git repository (not part of the parent Rails repo's
history) so it stays clean to deploy on its own.

## One-time setup

### 1. Get a YouTube Data API v3 key

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and
   create a new project (or reuse one you already have).
2. Enable the **YouTube Data API v3** for that project (APIs & Services →
   Library → search "YouTube Data API v3" → Enable).
3. Create an API key (APIs & Services → Credentials → Create Credentials →
   API key).
4. Restrict the key to the YouTube Data API v3 (recommended, not required).

The free quota (10,000 units/day) is far more than a personal feed with a
handful of playlists needs — `playlists.list`/`playlistItems.list` calls
cost 1 unit each, and syncing runs every 4 hours.

### 2. Install dependencies

```sh
npm install
```

(npm may prompt to approve postinstall scripts for `esbuild`/`workerd`/
`fsevents` — these fetch platform binaries wrangler/vitest need and are
safe to approve: `npm install-scripts approve <pkg>`.)

### 3. Local dev config

```sh
cp .dev.vars.example .dev.vars
# edit .dev.vars and paste in the API key from step 1
```

### 4. Create the D1 database

```sh
npx wrangler d1 create youtube-feed
```

Copy the `database_id` it prints into `wrangler.toml`, replacing
`REPLACE_ME_RUN_WRANGLER_D1_CREATE`.

Apply the schema locally:

```sh
npm run db:migrate:local
```

## Running locally

```sh
npm run dev
```

Cron-triggered jobs (sync/cleanup) don't fire automatically in local dev —
trigger them manually:

```sh
curl "http://localhost:8787/cdn-cgi/local/scheduled?cron=0+*/4+*+*+*"   # sync
curl "http://localhost:8787/cdn-cgi/local/scheduled?cron=0+3+*+*+*"     # cleanup
```

## Tests

```sh
npm test        # vitest, running inside the actual Workers runtime via @cloudflare/vitest-plugin
npm run typecheck
```

## Debugging playlist parsing

If a playlist stops picking up new videos, `scripts/debug-playlist.ts`
polls it directly via the YouTube Data API (no Worker/D1 needed) and prints
what comes back — the most recent videos, titles, publish dates:

```sh
npm run debug:playlist                                   # defaults to the ASOT example playlist
npm run debug:playlist -- "https://youtube.com/playlist?list=..."
```

It reads `YOUTUBE_API_KEY` from `.dev.vars` or the environment.

## Deploying

```sh
npx wrangler d1 create youtube-feed          # if not already created
npx wrangler d1 migrations apply youtube-feed --remote
npx wrangler secret put YOUTUBE_API_KEY
npm run deploy
```

This app has **no built-in authentication** — put it behind
[Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/)
(or similar) once deployed, since it'll otherwise be reachable by anyone
who finds the URL.

## Design notes

See the parent repo's project history for the full design discussion.
Key decisions baked into this code:

- **Fresh start, no data migration** from the Rails app's SQLite database.
  Re-subscribing to a playlist seeds it with the 10 most recent videos.
- **No ordering assumption** is made about the YouTube Data API's
  `playlistItems.list` response (undocumented for a channel's uploads
  playlist) — every sync fetches the whole playlist and diffs against
  known video IDs, rather than trying to detect "new videos" from item
  order or stopping pagination early.
- **Cleanup is a hard delete**, not a soft-hide — once a video is ≥95%
  watched and hasn't been touched in 7 days, its row is gone for good.
- **The 7-day grace clock runs off `last_watched_at`**, not off when a
  video first crossed 95% — an idle-but-occasionally-rewatched video keeps
  resetting the clock and is never swept. This is deliberate, not a bug.
- **Duration is never fetched up front.** It's `NULL` until a video is
  first loaded into the embed, at which point the YouTube IFrame Player API
  supplies it live.
