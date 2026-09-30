import type { PlaylistWithVideos, VideoRow } from "./db/queries";

export type { PlaylistWithVideos };

/** The ISO (UTC) date of the Monday starting the week containing `isoDate`. */
export function weekKey(isoDate: string): string {
  const date = new Date(isoDate);
  const day = date.getUTCDay(); // 0 (Sun) .. 6 (Sat)
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() + diffToMonday);
  return monday.toISOString().slice(0, 10);
}

/** All distinct week columns across every playlist's videos, oldest first. */
export function buildWeekColumns(playlists: PlaylistWithVideos[]): string[] {
  const weeks = new Set<string>();
  for (const playlist of playlists) {
    for (const video of playlist.videos) {
      weeks.add(weekKey(video.published_at));
    }
  }
  return [...weeks].sort();
}

/** Videos for one playlist, grouped by week column. */
export function groupVideosByWeek(playlist: PlaylistWithVideos): Map<string, VideoRow[]> {
  const groups = new Map<string, VideoRow[]>();
  for (const video of playlist.videos) {
    const key = weekKey(video.published_at);
    const existing = groups.get(key);
    if (existing) {
      existing.push(video);
    } else {
      groups.set(key, [video]);
    }
  }
  return groups;
}

/** Drops the year off a week column's key for display, e.g. "2026-08-24" -> "08-24". */
export function formatWeekLabel(week: string): string {
  return week.slice(5);
}
