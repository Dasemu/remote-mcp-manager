import { describe, expect, it, vi } from "vitest";
import { isOverLimit, startMemoryGuard } from "./memoryGuard.js";

const MB = 1024 * 1024;

describe("isOverLimit", () => {
  it("counts heap + external against the limit", () => {
    expect(isOverLimit({ heapUsed: 300 * MB, external: 250 * MB }, 512)).toBe(true);
    expect(isOverLimit({ heapUsed: 300 * MB, external: 100 * MB }, 512)).toBe(false);
  });

  it("is disabled when the limit is 0", () => {
    expect(isOverLimit({ heapUsed: 9999 * MB, external: 0 }, 0)).toBe(false);
  });
});

describe("startMemoryGuard", () => {
  it("fires onExceeded exactly once after the limit is passed", async () => {
    const onExceeded = vi.fn();
    const timer = startMemoryGuard({
      limitMb: 100,
      intervalMs: 5,
      sample: () => ({ heapUsed: 200 * MB, external: 0 }),
      onExceeded,
    });
    await new Promise((r) => setTimeout(r, 40));
    clearInterval(timer);
    expect(onExceeded).toHaveBeenCalledTimes(1);
  });

  it("does not start when disabled", () => {
    expect(startMemoryGuard({ limitMb: 0, onExceeded: () => {} })).toBeUndefined();
  });
});
