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

// Nixpacks' own current default (18) predates stable globalThis.crypto/fetch — used as the
// fallback for repos with a package.json but no version hint at all, confirmed in production
// against ZenvairoSocial-MCP: build succeeded, container crashed on "crypto is not defined".
const DEFAULT_NODE_VERSION = "20";

/**
 * Nixpacks doesn't fail when a repo's declared runtime requirement isn't met — it silently
 * falls back to its own default version (seen in practice: Node 18 picked for a repo requiring
 * >=20, build green, container crashed at runtime on a missing global). Pinning
 * NIXPACKS_NODE_VERSION from the repo's own .nvmrc/package.json closes that gap for Node repos;
 * repos with no hint of their own still get DEFAULT_NODE_VERSION rather than nixpacks' default.
 */
export function detectNodeVersion(repoDir: string): string | undefined {
  const nvmrcPath = path.join(repoDir, ".nvmrc");
  if (fs.existsSync(nvmrcPath)) {
    const version = parseMajorVersion(fs.readFileSync(nvmrcPath, "utf8"));
    if (version) return version;
  }

  const pkgPath = path.join(repoDir, "package.json");
  if (!fs.existsSync(pkgPath)) return undefined;

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { engines?: { node?: string } };
    const engineNode = pkg.engines?.node;
    if (typeof engineNode === "string") {
      const version = parseMajorVersion(engineNode);
      if (version) return version;
    }
  } catch {
    // malformed package.json — fall through to the default below
  }

  // It's a Node project (has a package.json) but declares no version of its own.
  return DEFAULT_NODE_VERSION;
}

export function runNixpacksBuild(
  slug: string,
  repoDir: string,
  imageTag: string,
  startCommand?: string | null,
): Promise<BuildResult> {
  return new Promise((resolve) => {
    const buildId = Date.now().toString();
    const logPath = buildLogPath(slug, buildId);
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const logStream = fs.createWriteStream(logPath, { flags: "a" });

    const args = ["build", repoDir, "--name", imageTag];
    if (startCommand) {
      // Lets an installation override the start command without needing a nixpacks.toml in
      // the source repo — necessary for third-party repos we don't control (e.g. installing
      // gitea.com/gitea/gitea-mcp as-is, which nixpacks builds fine but whose detected start
      // command needs CLI flags like `-t http -p <port>` appended).
      args.push("--start-cmd", startCommand);
    }
    const nodeVersion = detectNodeVersion(repoDir);
    if (nodeVersion) {
      // nixpacks does NOT read NIXPACKS_* config from the process environment — only from
      // its own `-e`/`--env` CLI flag (confirmed: setting it as a plain env var is silently
      // ignored, `nixpacks plan` still showed nodejs_18 for a repo pinned to 20 that way).
      args.push("-e", `NIXPACKS_NODE_VERSION=${nodeVersion}`);
      logStream.write(`[remote-mcp-manager] pinning NIXPACKS_NODE_VERSION=${nodeVersion}\n`);
    }

    const child = spawn("nixpacks", args);
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
