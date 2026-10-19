import type { ChildProcess } from "node:child_process";

/**
 * Kills the child's whole process group (SIGKILL) after `ms`. Spawn the child with `detached: true`
 * so it leads its own group. Plain `spawn({ timeout })` only signals the direct child: a grandchild
 * (e.g. the `docker build` nixpacks runs, or `ssh` under git) survives holding the stdio pipes, so
 * the child's 'close' event never fires and whatever awaits it hangs forever.
 */
export function killGroupAfter(child: ChildProcess, ms: number): void {
  const timer = setTimeout(() => {
    try {
      process.kill(-child.pid!, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }, ms);
  timer.unref();
  child.once("exit", () => clearTimeout(timer));
}
