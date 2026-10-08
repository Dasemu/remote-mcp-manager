import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { config } from "../config/env.js";

export function buildLogPath(slug: string, buildId: string): string {
  return path.join(config.logsDir, slug, `${buildId}.log`);
}

export interface BuildResult {
  success: boolean;
  logPath: string;
}

function parseMajorVersion(raw: string): string | undefined {
  const match = raw.match(/(\d+)/);
  return match ? match[1] : undefined;
}

/**
 * Nixpacks doesn't fail when a repo's declared runtime requirement isn't met — it silently
 * falls back to its own default version (seen in practice: Node 18 picked for a repo requiring
 * >=20, build green, container crashed at runtime on a missing global). Pinning
 * NIXPACKS_NODE_VERSION from the repo's own .nvmrc/package.json closes that gap for Node repos.
 */
export function detectNodeVersion(repoDir: string): string | undefined {
  const nvmrcPath = path.join(repoDir, ".nvmrc");
  if (fs.existsSync(nvmrcPath)) {
    const version = parseMajorVersion(fs.readFileSync(nvmrcPath, "utf8"));
    if (version) return version;
  }

  const pkgPath = path.join(repoDir, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { engines?: { node?: string } };
      const engineNode = pkg.engines?.node;
      if (typeof engineNode === "string") {
        const version = parseMajorVersion(engineNode);
        if (version) return version;
      }
    } catch {
      // malformed package.json — nothing to pin, let nixpacks use its default
    }
  }

  return undefined;
}

export function runNixpacksBuild(slug: string, repoDir: string, imageTag: string): Promise<BuildResult> {
  return new Promise((resolve) => {
    const buildId = Date.now().toString();
    const logPath = buildLogPath(slug, buildId);
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const logStream = fs.createWriteStream(logPath, { flags: "a" });

    const env = { ...process.env };
    const nodeVersion = detectNodeVersion(repoDir);
    if (nodeVersion) {
      env.NIXPACKS_NODE_VERSION = nodeVersion;
      logStream.write(
        `[remote-mcp-manager] pinning NIXPACKS_NODE_VERSION=${nodeVersion} (detected from .nvmrc/package.json engines.node)\n`,
      );
    }

    const child = spawn("nixpacks", ["build", repoDir, "--name", imageTag], { env });
    child.stdout.pipe(logStream, { end: false });
    child.stderr.pipe(logStream, { end: false });

    child.on("close", (code) => {
      logStream.end();
      resolve({ success: code === 0, logPath });
    });
    child.on("error", (err) => {
      logStream.write(`\nfailed to spawn nixpacks: ${err.message}\n`);
      logStream.end();
      resolve({ success: false, logPath });
    });
  });
}
