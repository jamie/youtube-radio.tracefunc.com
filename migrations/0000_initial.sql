-- Migration number: 0000 	 2026-09-28T00:00:00.000Z
-- Fresh start: no migration from the Rails app's SQLite data (see design discussion).

CREATE TABLE playlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  youtube_playlist_id TEXT NOT NULL UNIQUE,
  url TEXT NOT NULL,
  title TEXT,
  channel TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  videoid TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  published_at TEXT NOT NULL,
  -- Unset until the video is first loaded into the embed; the IFrame Player API
  -- supplies duration live, so we never fetch it up front from the YouTube API.
  duration_seconds REAL,
  progress_seconds REAL NOT NULL DEFAULT 0,
  -- Bumped on every progress report. The cleanup job's 7-day grace period is
  -- measured from here, not from when progress first crossed 95% — an
  -- idle-but-occasionally-rewatched video is meant to keep resetting the clock.
  last_watched_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_videos_playlist_id ON videos(playlist_id);
CREATE INDEX idx_videos_published_at ON videos(published_at);
