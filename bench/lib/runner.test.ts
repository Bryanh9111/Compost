import { describe, test, expect } from "bun:test";
import { percentile, runBench } from "./runner";

describe("percentile", () => {
  test("returns min for p0 on sorted array", () => {
    expect(percentile([1, 2, 3, 4, 5], 0)).toBe(1);
  });

  test("returns max for p100 on sorted array", () => {
    expect(percentile([1, 2, 3, 4, 5], 100)).toBe(5);
  });

  test("p50 on [1..100] is 50 (nearest-rank)", () => {
    const arr = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(arr, 50)).toBe(50);
  });

  test("p95 on [1..100] is 95", () => {
    const arr = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(arr, 95)).toBe(95);
  });

  test("returns 0 on empty array", () => {
    expect(percentile([], 50)).toBe(0);
  });

  test("unsorted input is handled (implementation sorts internally)", () => {
    expect(percentile([5, 1, 4, 2, 3], 50)).toBe(3);
  });
});

describe("runBench", () => {
  test("returns a BenchResult with p50/p95/p99/mean", async () => {
    const result = await runBench({
      name: "noop",
      iters: 10,
      warmup: 0,
      run: () => {
        // Spin briefly so measurements are non-zero.
        let x = 0;
        for (let i = 0; i < 1000; i++) x += i;
        return x;
      },
    });
    expect(result.name).toBe("noop");
    expect(result.iters).toBe(10);
    expect(result.p50_ms).toBeGreaterThanOrEqual(0);
    expect(result.p95_ms).toBeGreaterThanOrEqual(result.p50_ms);
    expect(result.p99_ms).toBeGreaterThanOrEqual(result.p95_ms);
    expect(result.mean_ms).toBeGreaterThanOrEqual(0);
    expect(result.min_ms).toBeLessThanOrEqual(result.p50_ms);
    expect(result.max_ms).toBeGreaterThanOrEqual(result.p99_ms);
  });

  test("runs setup before each iteration if provided", async () => {
    let setupCalls = 0;
    let runCalls = 0;
    await runBench({
      name: "setup-called",
      iters: 5,
      warmup: 0,
      setup: () => {
        setupCalls++;
      },
      run: () => {
        runCalls++;
      },
    });
    expect(setupCalls).toBe(5);
    expect(runCalls).toBe(5);
  });

  test("warmup iterations do not count toward timing", async () => {
    let runCalls = 0;
    const result = await runBench({
      name: "warmup-test",
      iters: 5,
      warmup: 3,
      run: () => {
        runCalls++;
      },
    });
    expect(runCalls).toBe(8); // 3 warmup + 5 measured
    expect(result.iters).toBe(5);
  });

  test("supports async run functions", async () => {
    const result = await runBench({
      name: "async",
      iters: 5,
      warmup: 0,
      run: async () => {
        await new Promise((r) => setTimeout(r, 1));
      },
    });
    expect(result.mean_ms).toBeGreaterThanOrEqual(0);
  });
});
