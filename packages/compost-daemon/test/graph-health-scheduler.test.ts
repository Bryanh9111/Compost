import { describe, test, expect } from "bun:test";
import { msUntilNextGraphHealthWindow } from "../src/scheduler";

/**
 * P0-3 Week 2: schedules at 04:00 UTC, one hour after backup's 03:00 slot.
 * Unlike the backup scheduler there is no grace window -- takeSnapshot is
 * itself same-day idempotent, so missing 04:00 by a minute and waiting for
 * the next day is acceptable.
 */
describe("msUntilNextGraphHealthWindow (P0-3 Week 2)", () => {
  test("at 03:59 UTC: returns ~1 minute until 04:00", () => {
    const now = new Date(Date.UTC(2026, 3, 15, 3, 59, 0, 0));
    const ms = msUntilNextGraphHealthWindow(now);
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(60_000);
  });

  test("at 04:01 UTC: waits until tomorrow 04:00 (~23h59m)", () => {
    const now = new Date(Date.UTC(2026, 3, 15, 4, 1, 0, 0));
    const ms = msUntilNextGraphHealthWindow(now);
    expect(ms).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect(ms).toBeLessThan(24 * 60 * 60 * 1000);
  });

  test("at 04:00:00 UTC exactly: waits a full day (<= is next)", () => {
    const now = new Date(Date.UTC(2026, 3, 15, 4, 0, 0, 0));
    const ms = msUntilNextGraphHealthWindow(now);
    expect(ms).toBeGreaterThan(23 * 60 * 60 * 1000);
  });

  test("at 12:00 UTC (mid-day): waits ~16 hours", () => {
    const now = new Date(Date.UTC(2026, 3, 15, 12, 0, 0, 0));
    const ms = msUntilNextGraphHealthWindow(now);
    expect(ms).toBeGreaterThan(15 * 60 * 60 * 1000);
    expect(ms).toBeLessThan(17 * 60 * 60 * 1000);
  });

  test("at 00:00 UTC: waits 4 hours", () => {
    const now = new Date(Date.UTC(2026, 3, 15, 0, 0, 0, 0));
    const ms = msUntilNextGraphHealthWindow(now);
    expect(ms).toBeGreaterThan(3.9 * 60 * 60 * 1000);
    expect(ms).toBeLessThan(4.1 * 60 * 60 * 1000);
  });
});
