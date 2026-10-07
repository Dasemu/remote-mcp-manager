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

export function runNixpacksBuild(slug: string, repoDir: string, imageTag: string): Promise<BuildResult> {
  return new Promise((resolve) => {
    const buildId = Date.now().toString();
    const logPath = buildLogPath(slug, buildId);
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const logStream = fs.createWriteStream(logPath, { flags: "a" });

    const child = spawn("nixpacks", ["build", repoDir, "--name", imageTag]);
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
