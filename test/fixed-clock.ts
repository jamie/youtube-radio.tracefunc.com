import { afterEach, beforeEach, vi } from "vitest";

// The sync cutoff is a rolling window off the current time (see
// minPublishedAt in youtube/client.ts), and test fixtures use fixed
// mid-August 2026 publish dates. Pinning JS's clock keeps those fixtures
// inside the window no matter when the suite runs. Only Date is faked —
// timers stay real so fetch/D1 promises resolve normally.
export const FIXED_NOW = new Date("2026-08-20T00:00:00Z");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});
