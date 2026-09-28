import { describe, expect, it } from "vitest";
import { computeProgressGlyph } from "../src/progress-glyph";

describe("computeProgressGlyph", () => {
  it("treats unknown duration as unwatched, regardless of progress_seconds", () => {
    expect(computeProgressGlyph(0, null)).toEqual({ char: "▁", percent: 0, state: "unwatched" });
    expect(computeProgressGlyph(50, null)).toEqual({ char: "▁", percent: 0, state: "unwatched" });
  });

  it("treats zero progress as unwatched", () => {
    expect(computeProgressGlyph(0, 100)).toEqual({ char: "▁", percent: 0, state: "unwatched" });
  });

  it("scales the block character with percent while in progress", () => {
    expect(computeProgressGlyph(50, 100)).toMatchObject({ percent: 0.5, state: "in-progress" });
    expect(computeProgressGlyph(10, 100).char).toBe("▁");
    expect(computeProgressGlyph(90, 100).char).toBe("▇");
  });

  it("never shows the full block below the 95% done threshold", () => {
    const glyph = computeProgressGlyph(94, 100);
    expect(glyph.state).toBe("in-progress");
    expect(glyph.char).not.toBe("█");
  });

  it("is done at exactly 95% and above", () => {
    expect(computeProgressGlyph(95, 100)).toMatchObject({ char: "█", state: "done" });
    expect(computeProgressGlyph(100, 100)).toMatchObject({ char: "█", state: "done" });
  });

  it("clamps percent to 100% if progress somehow exceeds duration", () => {
    expect(computeProgressGlyph(150, 100)).toMatchObject({ percent: 1, state: "done" });
  });
});
