// Entry point of the short-lived "updater" container (the NEW image run with this script).
// The manager can't replace itself — stopping its own container kills the code doing it — so it
// hands over to this process, which swaps the manager container for one running NEW_IMAGE and
// rolls back to the old container if the new one never becomes healthy.
// Standalone on purpose: it doesn't import the app's config/db modules.
import http from "node:http";
import Docker from "dockerode";
import { buildReplacementSpec } from "./containerSpec.js";

const socketPath = process.env.DOCKER_SOCKET_PATH ?? "/var/run/docker.sock";
const oldId = process.env.OLD_CONTAINER_ID;
const newImage = process.env.NEW_IMAGE;
const HEALTH_TIMEOUT_MS = 90_000;

const docker = new Docker({ socketPath });
const log = (msg: string) => console.log(`[self-update] ${msg}`);

function checkHealth(ip: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get({ host: ip, port, path: "/health", timeout: 2_000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitUntilHealthy(containerId: string, network: string, port: number): Promise<boolean> {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const info = await docker.getContainer(containerId).inspect();
    if (!info.State.Running && info.State.Status !== "restarting") return false;
    const ip = info.NetworkSettings.Networks[network]?.IPAddress;
    if (ip && (await checkHealth(ip, port))) return true;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  return false;
}

async function main(): Promise<number> {
  if (!oldId || !newImage) throw new Error("OLD_CONTAINER_ID and NEW_IMAGE are required");

  const oldContainer = docker.getContainer(oldId);
  const old = await oldContainer.inspect();
  const name = old.Name.replace(/^\//, "");
  const oldImageEnv = (await docker.getImage(old.Image).inspect()).Config.Env ?? [];
  const spec = buildReplacementSpec(old, oldImageEnv, newImage);
  const network = old.HostConfig.NetworkMode ?? "default";
  const port = Number(old.Config.Env?.find((e) => e.startsWith("PORT="))?.slice(5) ?? 3000);

  // The old container holds the name and the published port, so it has to go first. It is only
  // renamed and stopped (not removed) so it can be started again if the new one fails. Renaming
  // comes first, while it is still running: if that fails, nothing has been touched yet.
  const backupName = `${name}-pre-update`;
  await docker.getContainer(backupName).remove({ force: true }).catch(() => {});
  await oldContainer.rename({ name: backupName });
  log(`stopping ${name} (${old.Id.slice(0, 12)})`);
  try {
    await oldContainer.stop({ t: 15 });
  } catch (err) {
    if ((err as { statusCode?: number }).statusCode !== 304) {
      await oldContainer.rename({ name }).catch(() => {});
      throw err;
    }
  }

  let created: Docker.Container | undefined;
  let healthy = false;
  try {
    log(`starting new container from ${newImage}`);
    created = await docker.createContainer(spec);
    await created.start();
    healthy = await waitUntilHealthy(created.id, network, port);
    if (!healthy) log(`new manager did not become healthy within ${HEALTH_TIMEOUT_MS / 1000}s`);
  } catch (err) {
    log(`failed to start the new container: ${(err as Error).message}`);
  }

  if (healthy) {
    // The update has succeeded; failing to tidy up must not undo it.
    log("new manager is healthy, removing the old container");
    await oldContainer.remove({ force: true }).catch((err) => log(`could not remove the old container: ${err.message}`));
    await docker.getImage(old.Image).remove({ force: false }).catch(() => {});
    log("update complete");
    return 0;
  }

  // Every rollback step is attempted on its own: the old container must be started again even if
  // an earlier step failed.
  log("rolling back to the previous manager");
  if (created) await created.remove({ force: true }).catch((err) => log(`could not remove the new container: ${err.message}`));
  await oldContainer.rename({ name }).catch((err) => log(`could not restore the name: ${err.message}`));
  await oldContainer.start().catch((err) => log(`could not start the old container: ${err.message}`));
  await docker.getImage(newImage).remove({ force: false }).catch(() => {});
  log("rollback complete");
  return 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    log(`fatal: ${(err as Error).stack ?? err}`);
    process.exit(2);
  },
);
