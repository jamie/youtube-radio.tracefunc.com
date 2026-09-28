import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

// Setup files run outside the per-test-file storage isolation and may run
// more than once; applyD1Migrations() only applies migrations that haven't
// already been applied, so calling it here unconditionally is safe.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
