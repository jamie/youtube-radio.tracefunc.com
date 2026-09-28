declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    YOUTUBE_API_KEY: string;
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[]; // Defined in vitest.config.ts
  }
}
