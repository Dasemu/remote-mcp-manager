import fs from "node:fs";
import path from "node:path";
import { config } from "../config/env.js";
import { run } from "../build/git.js";
import { type CommitSummary, parseCommitLog } from "./commits.js";

// A bare repo that only ever holds commit history (no blobs) of the update source, so counting
// "how far behind" doesn't need a full clone. Name can't collide with an installation slug.
const CHECK_DIR = "_manager-check";
const OK_TTL_MS = 10 * 60 * 1000;
const ERROR_TTL_MS = 60 * 1000;
const MAX_LISTED = 20;
// The panel waits on this, so it gets far less than the 5 min installs allow for a clone.
const GIT_CHECK_TIMEOUT_MS = 60 * 1000;

export interface RemoteStatus {
  checkedAt: string;
  remoteSha: string | null;
  /** Commits on the remote that the installed build doesn't have; null when it can't be told. */
  behind: number | null;
  commits: CommitSummary[];
  error: string | null;
}

let cached: { status: RemoteStatus; expires: number; forSha: string | undefined } | null = null;
let inFlight: Promise<RemoteStatus> | null = null;
let queuedForce: Promise<RemoteStatus> | null = null;

async function git(cwd: string, args: string[]) {
  return run("git", args, cwd, GIT_CHECK_TIMEOUT_MS).catch((err: Error) => ({ code: 1, output: err.message }));
}

async function compute(installedSha: string | undefined): Promise<RemoteStatus> {
  const base: RemoteStatus = { checkedAt: new Date().toISOString(), remoteSha: null, behind: null, commits: [], error: null };
  const url = config.selfUpdateRepoUrl;
  if (!url) return { ...base, error: "SELF_UPDATE_REPO_URL is not set" };

  const dir = path.join(config.reposDir, CHECK_DIR);
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(path.join(dir, "HEAD"))) {
    const init = await git(dir, ["init", "--bare", "--quiet"]);
    if (init.code !== 0) return { ...base, error: `git init failed: ${init.output.trim()}` };
  }

  // Blobless fetch where the server supports it; plain fetch otherwise.
  const fetchTail = ["--quiet", "--no-tags", "--", url, config.selfUpdateRef];
  let fetched = await git(dir, ["fetch", "--filter=blob:none", ...fetchTail]);
  // Only a server that doesn't do partial clones warrants the retry; an unreachable one would
  // just make the panel wait twice as long.
  if (fetched.code !== 0 && /filter/i.test(fetched.output)) fetched = await git(dir, ["fetch", ...fetchTail]);
  if (fetched.code !== 0) return { ...base, error: `git fetch failed: ${fetched.output.trim().slice(-300)}` };

  const head = await git(dir, ["rev-parse", "--verify", "FETCH_HEAD^{commit}"]);
  const remoteSha = head.output.trim();
  if (head.code !== 0 || !remoteSha) return { ...base, error: "could not read the fetched head" };
  if (!installedSha) return { ...base, remoteSha };
  if (remoteSha.startsWith(installedSha)) return { ...base, remoteSha, behind: 0 };

  // The installed commit has to be an ancestor of the remote head to count what is new; if it
  // isn't (force-push, other branch, local build) we can only report the remote head.
  const isAncestor = await git(dir, ["merge-base", "--is-ancestor", installedSha, remoteSha]);
  if (isAncestor.code !== 0) return { ...base, remoteSha };

  const range = `${installedSha}..${remoteSha}`;
  const count = await git(dir, ["rev-list", "--count", range]);
  const behind = Number.parseInt(count.output.trim(), 10);
  if (count.code !== 0 || Number.isNaN(behind)) {
    return { ...base, remoteSha, error: `git rev-list failed: ${count.output.trim().slice(-200)}` };
  }
  const log = await git(dir, ["log", `-n${MAX_LISTED}`, "--format=%h%x09%s", range]);
  return { ...base, remoteSha, behind, commits: log.code === 0 ? parseCommitLog(log.output) : [] };
}

function start(installedSha: string | undefined): Promise<RemoteStatus> {
  inFlight = compute(installedSha)
    .catch((err: Error): RemoteStatus => ({
      checkedAt: new Date().toISOString(),
      remoteSha: null,
      behind: null,
      commits: [],
      error: err.message,
    }))
    .then((status) => {
      cached = { status, expires: Date.now() + (status.error ? ERROR_TTL_MS : OK_TTL_MS), forSha: installedSha };
      return status;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/**
 * Cached for a few minutes; concurrent callers share one fetch. `force` skips the cache, and if a
 * fetch is already running (it may have read the refs before a push) waits for it and runs a
 * fresh one after it — at most one is ever queued.
 */
export function checkRemote(installedSha: string | undefined, force = false): Promise<RemoteStatus> {
  if (!force && cached && cached.expires > Date.now() && cached.forSha === installedSha) {
    return Promise.resolve(cached.status);
  }
  if (!inFlight) return start(installedSha);
  if (!force) return inFlight;
  queuedForce ??= inFlight.then(() => {
    queuedForce = null;
    return start(installedSha);
  });
  return queuedForce;
}

/** Last known result without triggering a fetch (null if none yet). */
export function cachedRemoteStatus(): RemoteStatus | null {
  return cached?.status ?? null;
}

export function isRemoteCheckStale(installedSha: string | undefined): boolean {
  return !cached || cached.expires <= Date.now() || cached.forSha !== installedSha;
}
