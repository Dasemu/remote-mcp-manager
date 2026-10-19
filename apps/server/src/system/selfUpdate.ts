import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import Docker from "dockerode";
import { config } from "../config/env.js";
import { listInstallations } from "../db/installations.js";
import { cloneOrUpdateRepo, readHeadSha, repoDir } from "../build/git.js";
import { enqueueBuild } from "../service/buildQueue.js";
import { killGroupAfter } from "../util/processTimeout.js";
import { withTimeout } from "../util/withTimeout.js";
import { demuxLogs } from "./dockerLogs.js";
import { cachedRemoteStatus, checkRemote, isRemoteCheckStale } from "./remoteCheck.js";
import { readInstalledSha, readVersion } from "./version.js";

const docker = new Docker({ socketPath: config.dockerSocketPath });

const HELPER_LABEL = "remote-mcp-manager.self-update-helper";
const BUILD_TIMEOUT_MS = 30 * 60 * 1000;
// Updater: up to 90 s of health checks plus stop/create/rollback; this is only a backstop.
const HANDOVER_TIMEOUT_MS = 5 * 60 * 1000;
// The checkout lives under a name no installation slug can take (slugify strips underscores).
const CHECKOUT_SLUG = "_manager";
const BUSY_STATUSES = new Set(["cloning", "building", "starting"]);

type Phase = "idle" | "cloning" | "building" | "handing-over";

const state: { phase: Phase; error?: string; logPath?: string } = { phase: "idle" };
let lastResult: { finishedAt: string; ok: boolean; log: string } | null = null;

/** The container this process runs in (Docker sets the hostname to the container id), if any. */
async function inspectSelf() {
  try {
    return await withTimeout(docker.getContainer(os.hostname()).inspect(), 10_000, "docker inspect self");
  } catch {
    return undefined;
  }
}

function tailOfLog(maxLines = 200): string {
  if (!state.logPath || !fs.existsSync(state.logPath)) return "";
  return fs.readFileSync(state.logPath, "utf8").split("\n").slice(-maxLines).join("\n");
}

export async function getSystemInfo() {
  // The updater is usually still running when the new manager boots, so its result can only be
  // collected later; polling this endpoint is what picks it up.
  if (!lastResult && state.phase === "idle") await collectSelfUpdateResult();
  const self = await inspectSelf();
  const installedSha = readInstalledSha();
  // Refresh in the background so this endpoint never waits on a git fetch.
  if (config.selfUpdateRepoUrl && state.phase === "idle" && isRemoteCheckStale(installedSha)) {
    void checkRemote(installedSha);
  }
  return {
    version: readVersion(),
    sha: installedSha ?? null,
    remote: cachedRemoteStatus(),
    uptimeSec: Math.round(process.uptime()),
    canSelfUpdate: Boolean(config.selfUpdateRepoUrl && self),
    unavailableReason: !config.selfUpdateRepoUrl
      ? "SELF_UPDATE_REPO_URL is not set"
      : !self
        ? "the manager is not running inside a container it can inspect"
        : null,
    ref: config.selfUpdateRef,
    phase: state.phase,
    error: state.error ?? null,
    log: state.phase === "idle" && !state.error ? "" : tailOfLog(),
    lastUpdate: lastResult,
  };
}

function runDockerBuild(contextDir: string, image: string, logPath: string, sha: string | undefined): Promise<boolean> {
  return new Promise((resolve) => {
    const logStream = fs.createWriteStream(logPath, { flags: "a" });
    const child = spawn("docker", ["build", "-t", image, ...(sha ? ["--build-arg", `GIT_SHA=${sha}`] : []), contextDir], { detached: true });
    killGroupAfter(child, BUILD_TIMEOUT_MS);
    child.stdout.pipe(logStream, { end: false });
    child.stderr.pipe(logStream, { end: false });
    child.on("close", (code) => {
      logStream.end();
      resolve(code === 0);
    });
    child.on("error", (err) => {
      logStream.write(`\nfailed to spawn docker: ${err.message}\n`);
      logStream.end();
      resolve(false);
    });
  });
}

async function runUpdate(self: Docker.ContainerInspectInfo): Promise<void> {
  const url = config.selfUpdateRepoUrl!;
  const image = `mcpmgr-manager:update-${Date.now()}`;
  const logDir = path.join(config.logsDir, CHECKOUT_SLUG);
  fs.mkdirSync(logDir, { recursive: true });
  state.logPath = path.join(logDir, `${Date.now()}.log`);
  const note = (msg: string) => fs.appendFileSync(state.logPath!, `[self-update] ${msg}\n`);

  try {
    // Same queue as installation builds: never two heavy builds at once on a small host. The
    // hand-over below also happens inside it, so no queued build can start while the manager is
    // about to be swapped out.
    await enqueueBuild(async () => {
      state.phase = "cloning";
      note(`cloning ${url} (${config.selfUpdateRef})`);
      await cloneOrUpdateRepo(CHECKOUT_SLUG, url, config.selfUpdateRef);

      state.phase = "building";
      note(`building ${image}`);
      const sha = await readHeadSha(repoDir(CHECKOUT_SLUG));
      note(`building commit ${sha ?? "unknown"}`);
      if (!(await runDockerBuild(repoDir(CHECKOUT_SLUG), image, state.logPath!, sha))) {
        throw new Error(`image build failed, see ${state.logPath}`);
      }

      state.phase = "handing-over";
      const socketBind = (self.HostConfig.Binds ?? []).find((b) => b.split(":")[1] === config.dockerSocketPath);
      if (!socketBind) throw new Error(`no bind mount for ${config.dockerSocketPath} on the manager container`);

      note("starting the updater container; the manager will restart shortly");
      const helper = await docker.createContainer({
        Image: image,
        Cmd: ["node", "dist/system/selfUpdateHelper.js"],
        Env: [
          `OLD_CONTAINER_ID=${self.Id}`,
          `NEW_IMAGE=${image}`,
          `DOCKER_SOCKET_PATH=${config.dockerSocketPath}`,
        ],
        Labels: { [HELPER_LABEL]: "1" },
        HostConfig: {
          Binds: [socketBind],
          SecurityOpt: self.HostConfig.SecurityOpt ?? undefined,
          NetworkMode: self.HostConfig.NetworkMode,
          RestartPolicy: { Name: "no" },
        },
      });
      await helper.start();

      // A successful hand-over kills this process, so getting past this wait means the updater
      // ended without replacing us (crashed early, rolled back before stopping us) or hung.
      const exit = (await withTimeout(helper.wait(), HANDOVER_TIMEOUT_MS, "updater container")) as { StatusCode: number };
      await collectSelfUpdateResult();
      throw new Error(
        exit.StatusCode === 0
          ? "the updater finished but this manager is still running"
          : `the updater exited with code ${exit.StatusCode}${lastResult ? `:\n${lastResult.log.split("\n").slice(-15).join("\n")}` : ""}`,
      );
    });
  } catch (err) {
    state.phase = "idle";
    state.error = (err as Error).message;
    note(`failed: ${state.error}`);
  }
}

/** True from the moment an update is requested until it fails; a successful one ends this process. */
export function isSelfUpdateInProgress(): boolean {
  return state.phase !== "idle";
}

/** Forces a fresh look at the remote (the panel's "Check now"). */
export function refreshRemoteStatus() {
  return checkRemote(readInstalledSha(), true);
}

export class SelfUpdateError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Validates preconditions and starts the update in the background. Throws SelfUpdateError if it can't. */
export async function startSelfUpdate(): Promise<void> {
  if (!config.selfUpdateRepoUrl) throw new SelfUpdateError("SELF_UPDATE_REPO_URL is not set", 400);
  if (state.phase !== "idle") throw new SelfUpdateError("an update is already in progress", 409);
  if (listInstallations().some((i) => BUSY_STATUSES.has(i.status))) {
    throw new SelfUpdateError("an installation is building or starting; wait for it to finish", 409);
  }

  // Claimed before the first await so two concurrent requests can't both start an update.
  state.phase = "cloning";
  state.error = undefined;
  const self = await inspectSelf();
  if (!self) {
    state.phase = "idle";
    throw new SelfUpdateError("the manager is not running inside a container it can inspect", 400);
  }
  void runUpdate(self);
}

/**
 * Called once at boot: if an updater container left a result behind (this process is either the
 * freshly updated manager or the one the updater rolled back to), record its log and clean it up.
 */
export async function collectSelfUpdateResult(): Promise<void> {
  try {
    const helpers = await withTimeout(
      docker.listContainers({ all: true, filters: { label: [HELPER_LABEL] } }),
      10_000,
      "docker list updater",
    );
    for (const h of helpers) {
      if (h.State === "running") continue;
      const container = docker.getContainer(h.Id);
      const info = await withTimeout(container.inspect(), 10_000, "docker inspect updater");
      const logs = (await withTimeout(
        container.logs({ stdout: true, stderr: true }),
        10_000,
        "docker logs updater",
      )) as unknown as Buffer;
      lastResult = {
        finishedAt: info.State.FinishedAt,
        ok: info.State.ExitCode === 0,
        log: demuxLogs(Buffer.from(logs)),
      };
      await withTimeout(container.remove({ force: true }), 10_000, "docker rm updater");
    }
  } catch {
    // Best effort: no Docker access (e.g. local dev) just means there is nothing to report.
  }
}
