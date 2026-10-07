import fs from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { config } from "../config/env.js";

function run(cmd: string, args: string[], cwd?: string): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd });
    let output = "";
    child.stdout.on("data", (d) => (output += d.toString()));
    child.stderr.on("data", (d) => (output += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, output }));
  });
}

export function repoDir(slug: string): string {
  return path.join(config.reposDir, slug);
}

export async function cloneOrUpdateRepo(slug: string, repoUrl: string, gitRef?: string | null): Promise<string> {
  const dir = repoDir(slug);
  fs.mkdirSync(config.reposDir, { recursive: true });

  if (fs.existsSync(path.join(dir, ".git"))) {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  const clone = await run("git", ["clone", "--depth", "1", ...(gitRef ? ["--branch", gitRef] : []), repoUrl, dir]);
  if (clone.code !== 0) {
    throw new Error(`git clone failed: ${clone.output}`);
  }

  return dir;
}

export function readEnvExampleKeys(dir: string): string[] {
  const file = path.join(dir, ".env.example");
  if (!fs.existsSync(file)) return [];
  const content = fs.readFileSync(file, "utf8");
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => line.split("=")[0]!.trim());
}
