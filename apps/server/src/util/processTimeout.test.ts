import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { killGroupAfter } from "./processTimeout.js";

describe("killGroupAfter", () => {
  it("kills a hung grandchild so the child's 'close' event still fires", async () => {
    // The shell backgrounds `sleep` (a grandchild that inherits stdio) and waits on it.
    const child = spawn("sh", ["-c", "sleep 30 & wait"], { detached: true });
    killGroupAfter(child, 100);
    const started = Date.now();
    await new Promise((resolve) => child.on("close", resolve));
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("does nothing to a process that exits on its own", async () => {
    const child = spawn("sh", ["-c", "exit 0"], { detached: true });
    killGroupAfter(child, 60_000);
    const code = await new Promise((resolve) => child.on("close", resolve));
    expect(code).toBe(0);
  });
});
