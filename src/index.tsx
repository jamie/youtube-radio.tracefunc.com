import { Hono } from "hono";
import type { Bindings } from "./bindings";
import { PLAYER_SCRIPT } from "./client/player-script";
import { getPlaylistById, listPlaylistsWithVideos, recordProgress } from "./db/queries";
import { runCleanup } from "./jobs/cleanup";
import { syncAllPlaylists } from "./jobs/sync";
import { subscribeToPlaylist, updatePlaylistDetails } from "./playlists";
import { EditPlaylist } from "./views/EditPlaylist";
import { Grid } from "./views/Grid";
import { Layout } from "./views/Layout";

export const app = new Hono<{ Bindings: Bindings }>();

app.get("/", async (c) => {
  const playlists = await listPlaylistsWithVideos(c.env.DB);
  return c.html(
    <Layout>
      <Grid playlists={playlists} />
    </Layout>,
  );
});

app.post("/playlists", async (c) => {
  const body = await c.req.parseBody();
  const url = body["url"];
  if (typeof url !== "string" || url.length === 0) {
    return c.text("Missing playlist url", 400);
  }
  await subscribeToPlaylist(c.env.DB, c.env.YOUTUBE_API_KEY, url);
  return c.redirect("/");
});

app.get("/playlists/:id/edit", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.text("Invalid playlist id", 400);
  const playlist = await getPlaylistById(c.env.DB, id);
  if (!playlist) return c.text("Playlist not found", 404);
  return c.html(
    <Layout>
      <EditPlaylist playlist={playlist} />
    </Layout>,
  );
});

app.post("/playlists/:id/edit", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.text("Invalid playlist id", 400);
  const body = await c.req.parseBody();
  const url = body["url"];
  const title = body["title"];
  if (typeof url !== "string" || url.length === 0 || typeof title !== "string" || title.length === 0) {
    return c.text("Missing url or title", 400);
  }
  await updatePlaylistDetails(c.env.DB, id, { url, title });
  return c.redirect("/");
});

app.post("/api/progress", async (c) => {
  const body = await c.req.json<{ videoId?: string; currentTime?: number; duration?: number }>();
  if (
    typeof body.videoId !== "string" ||
    typeof body.currentTime !== "number" ||
    typeof body.duration !== "number" ||
    !(body.duration > 0)
  ) {
    return c.text("Invalid progress payload", 400);
  }
  await recordProgress(c.env.DB, body.videoId, {
    progressSeconds: body.currentTime,
    durationSeconds: body.duration,
  });
  return c.body(null, 204);
});

app.get("/player.js", (c) => {
  c.header("content-type", "application/javascript; charset=utf-8");
  return c.body(PLAYER_SCRIPT);
});

const SYNC_CRON = "0 */4 * * *";
const CLEANUP_CRON = "0 3 * * *";

export default {
  fetch: app.fetch,
  async scheduled(event, env, ctx) {
    if (event.cron === SYNC_CRON) {
      ctx.waitUntil(
        syncAllPlaylists(env.DB, env.YOUTUBE_API_KEY).then((results) => {
          for (const result of results) {
            if (result.error) {
              console.error(`sync failed for playlist ${result.playlistId}: ${result.error}`);
            }
          }
        }),
      );
    } else if (event.cron === CLEANUP_CRON) {
      ctx.waitUntil(
        runCleanup(env.DB).then((result) => {
          console.log(`cleanup removed ${result.deleted.length} video(s)`);
        }),
      );
    }
  },
} satisfies ExportedHandler<Bindings>;
