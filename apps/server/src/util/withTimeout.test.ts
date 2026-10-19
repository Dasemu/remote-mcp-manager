import { describe, expect, it } from "vitest";
import { withTimeout } from "./withTimeout.js";
import { createSerialQueue } from "./serialQueue.js";

describe("withTimeout", () => {
  it("resolves with the value when the promise settles in time", async () => {
    await expect(withTimeout(Promise.resolve(42), 100, "x")).resolves.toBe(42);
  });

  it("rejects when the promise never settles", async () => {
    await expect(withTimeout(new Promise(() => {}), 10, "docker inspect")).rejects.toThrow(
      "docker inspect timed out after 10ms",
    );
  });
});

describe("createSerialQueue", () => {
  it("never runs two tasks at once and keeps going after a failure", async () => {
    const enqueue = createSerialQueue();
    let running = 0;
    let maxRunning = 0;
    const task = (fail = false) => async () => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 5));
      running -= 1;
      if (fail) throw new Error("boom");
      return "ok";
    };

    const results = await Promise.allSettled([enqueue(task()), enqueue(task(true)), enqueue(task())]);

    expect(maxRunning).toBe(1);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
  });
});
