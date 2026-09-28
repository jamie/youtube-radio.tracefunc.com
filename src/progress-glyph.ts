// Unicode block elements U+2581 (▁) through U+2588 (█), one per eighth of
// progress. Used to replace the old read-only "watched?" checkbox with a
// finer-grained indicator now that the embed gives us a real percentage
// instead of Plex's watched/unwatched boolean.
const BLOCKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

export const CLEANUP_PROGRESS_THRESHOLD = 0.95;

export type ProgressState = "unwatched" | "in-progress" | "done";

export interface ProgressGlyph {
  char: string;
  percent: number;
  state: ProgressState;
}

/**
 * Computes the grid indicator for a video. `durationSeconds` is null until
 * the video has actually been loaded into the embed at least once (we never
 * fetch duration up front from the YouTube API — see youtube/client.ts).
 */
export function computeProgressGlyph(
  progressSeconds: number,
  durationSeconds: number | null,
): ProgressGlyph {
  if (!durationSeconds || durationSeconds <= 0) {
    return { char: BLOCKS[0]!, percent: 0, state: "unwatched" };
  }

  const percent = Math.min(1, Math.max(0, progressSeconds / durationSeconds));

  if (percent >= CLEANUP_PROGRESS_THRESHOLD) {
    return { char: BLOCKS[7]!, percent, state: "done" };
  }
  if (percent === 0) {
    return { char: BLOCKS[0]!, percent, state: "unwatched" };
  }

  const level = Math.min(7, Math.max(1, Math.round(percent * 8)));
  return { char: BLOCKS[level - 1]!, percent, state: "in-progress" };
}
