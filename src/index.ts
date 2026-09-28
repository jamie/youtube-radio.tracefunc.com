import { Hono } from "hono";
import type { Bindings } from "./bindings";

const app = new Hono<{ Bindings: Bindings }>();

app.get("/", (c) => c.text("youtube-feed worker: under construction"));

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Bindings>;
