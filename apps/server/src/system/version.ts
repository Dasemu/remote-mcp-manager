import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { normalizeSha } from "./commits.js";

// VERSION sits at the repo root, four levels above this file in both the image and a checkout:
// <root>/apps/server/{src,dist}/system/version.*
const repoRoot = path.resolve(import.meta.dirname, "../../../..");
const versionFile = path.join(repoRoot, "VERSION");

export function readVersion(): string {
  try {
    return fs.readFileSync(versionFile, "utf8").trim() || "unknown";
  } catch {
    return "unknown";
  }
}

let sha: string | undefined | null = null;

/**
 * Commit this build was made from. The image gets it as the GIT_SHA build arg (see the
 * Dockerfile); in a plain checkout (local dev) it is read from git instead.
 */
export function readInstalledSha(): string | undefined {
  if (sha !== null) return sha;
  sha = normalizeSha(process.env.GIT_SHA);
  if (!sha) {
    try {
      sha = normalizeSha(execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, timeout: 3000, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
    } catch {
      sha = undefined;
    }
  }
  return sha;
}
