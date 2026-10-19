import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "remote-check-"));
const origin = path.join(tmp, "origin");
const shas: string[] = [];

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
  }).trim();
}

async function load(ref = "main") {
  vi.resetModules();
  vi.stubEnv("DATA_DIR", path.join(tmp, "data"));
  vi.stubEnv("SELF_UPDATE_REPO_URL", origin);
  vi.stubEnv("SELF_UPDATE_REF", ref);
  return import("./remoteCheck.js");
}

beforeAll(() => {
  fs.mkdirSync(origin);
  git(origin, "init", "-q", "-b", "main");
  for (const n of [1, 2, 3]) {
    fs.writeFileSync(path.join(origin, "f.txt"), String(n));
    git(origin, "add", ".");
    git(origin, "commit", "-q", "-m", `commit ${n}`);
    shas.push(git(origin, "rev-parse", "HEAD"));
  }
});

afterAll(() => {
  vi.unstubAllEnvs();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("checkRemote", () => {
  it("resolves an annotated tag to its commit", async () => {
    git(origin, "tag", "-a", "v1", "-m", "release", shas[2]!);
    const { checkRemote } = await load("v1");
    const status = await checkRemote(shas[0], true);
    expect(status.remoteSha).toBe(shas[2]);
    expect(status.behind).toBe(2);
  });

  it("runs a fresh check after a forced refresh requested mid-flight", async () => {
    const { checkRemote } = await load();
    const first = checkRemote(shas[0]);
    const forced = checkRemote(shas[0], true);
    const [a, b] = await Promise.all([first, forced]);
    expect(b.checkedAt >= a.checkedAt).toBe(true);
    expect(b).not.toBe(a);
  });

  it("counts the commits the installed sha is missing", async () => {
    const { checkRemote } = await load();
    const status = await checkRemote(shas[0], true);
    expect(status.error).toBeNull();
    expect(status.remoteSha).toBe(shas[2]);
    expect(status.behind).toBe(2);
    expect(status.commits.map((c) => c.subject)).toEqual(["commit 3", "commit 2"]);
  });

  it("reports 0 when installed is the remote head", async () => {
    const { checkRemote } = await load();
    expect((await checkRemote(shas[2], true)).behind).toBe(0);
  });

  it("reports the remote head only when the installed sha is unknown to it", async () => {
    const { checkRemote } = await load();
    const status = await checkRemote("deadbeefdeadbeef", true);
    expect(status.behind).toBeNull();
    expect(status.remoteSha).toBe(shas[2]);
    expect(status.error).toBeNull();
  });

  it("reports an error instead of throwing when the remote is unreachable", async () => {
    await load();
    vi.stubEnv("SELF_UPDATE_REPO_URL", path.join(tmp, "does-not-exist"));
    vi.resetModules();
    const mod = await import("./remoteCheck.js");
    const status = await mod.checkRemote(shas[0], true);
    expect(status.error).toMatch(/git fetch failed/);
    expect(status.behind).toBeNull();
  });
});
