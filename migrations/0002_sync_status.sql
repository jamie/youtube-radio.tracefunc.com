-- Migration number: 0002 	 2026-10-14T20:00:00.000Z
-- The sync job only ever reported failures via console.error, which isn't
-- queryable after the fact — there was no way to tell a playlist had been
-- silently failing every run for weeks versus simply having no new videos.
-- Persisting the outcome of the most recent attempt makes that visible.

ALTER TABLE playlists ADD COLUMN last_synced_at TEXT;
ALTER TABLE playlists ADD COLUMN last_sync_error TEXT;
