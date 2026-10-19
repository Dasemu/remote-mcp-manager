import net from "node:net";
import Docker from "dockerode";
import { config } from "../config/env.js";
import type { Installation } from "../db/installations.js";
import { withTimeout } from "../util/withTimeout.js";
import { isNotFoundError, isNotModifiedError } from "./errors.js";

const docker = new Docker({ socketPath: config.dockerSocketPath });

export async function ensureNetwork(name: string): Promise<void> {
  const networks = await docker.listNetworks({ filters: { name: [name] } });
  if (networks.length === 0) {
    await docker.createNetwork({ Name: name, Driver: "bridge" });
  }
}

// Every proxied MCP request needs the container's IP. Asking Docker each time meant a slow
// daemon stalled every request at once (and each one held its socket while waiting); a short
// cache plus a call timeout keeps one wedged Docker daemon from snowballing into the proxy.
const IP_CACHE_TTL_MS = 5_000;
const DOCKER_CALL_TIMEOUT_MS = 10_000;
// stop/restart send SIGTERM and wait the daemon's grace period (10s) before SIGKILL.
const DOCKER_STOP_TIMEOUT_MS = 30_000;
const ipCache = new Map<string, { ip: Promise<string>; expires: number }>();

export async function removeContainerIfExists(containerName: string): Promise<void> {
  ipCache.delete(containerName);
  try {
    await docker.getContainer(containerName).remove({ force: true });
  } catch {
    // didn't exist, nothing to clean up
  }
}

export async function runInstallationContainer(installation: Installation): Promise<string> {
  if (!installation.imageTag) throw new Error("installation has no built image yet");

  await ensureNetwork(config.mcpNetworkName);
  await removeContainerIfExists(installation.containerName);
  ipCache.delete(installation.containerName);

  const env = {
    ...installation.env,
    [installation.portEnvVar]: String(installation.internalPort),
    [installation.hostEnvVar]: "0.0.0.0",
  };

  // Installations are unreachable from outside mcp-net by design — every MCP client goes
  // through the manager's own reverse proxy. publishHostPort is the one deliberate exception:
  // it publishes the container's port to the host's loopback, for a native process on the same
  // host (e.g. a legacy nginx location) that needs to reach this container directly.
  const portBinding = installation.publishHostPort
    ? { [`${installation.internalPort}/tcp`]: [{ HostIp: "127.0.0.1", HostPort: String(installation.publishHostPort) }] }
    : undefined;

  // Bind-mounts a host directory into the container — for state that must survive rebuilds
  // and that nothing else manages (e.g. a browser profile with an existing logged-in session).
  const binds = installation.hostVolumes.map((v) => `${v.hostPath}:${v.containerPath}`);

  const container = await docker.createContainer({
    name: installation.containerName,
    Image: installation.imageTag,
    Env: Object.entries(env).map(([k, v]) => `${k}=${v}`),
    ...(portBinding ? { ExposedPorts: { [`${installation.internalPort}/tcp`]: {} } } : {}),
    HostConfig: {
      RestartPolicy: { Name: "unless-stopped" },
      NetworkMode: config.mcpNetworkName,
      // 0 disables the cap: some hosts (e.g. an unprivileged, OpenRC-based nested LXC with no
      // systemd to delegate cgroup controllers) can't enforce per-container memory/CPU limits
      // at all — `docker run` there fails outright trying to write memory.max. Confirmed on a
      // real deploy; the outer host's own cap (if any) is the only ceiling in that case.
      ...(config.containerMemoryMb > 0 ? { Memory: config.containerMemoryMb * 1024 * 1024 } : {}),
      ...(config.containerCpus > 0 ? { NanoCpus: Math.round(config.containerCpus * 1e9) } : {}),
      ...(portBinding ? { PortBindings: portBinding } : {}),
      ...(binds.length > 0 ? { Binds: binds } : {}),
    },
  });

  await container.start();
  return container.id;
}

export async function getImageId(imageTag: string): Promise<string | undefined> {
  try {
    const info = await withTimeout(docker.getImage(imageTag).inspect(), DOCKER_CALL_TIMEOUT_MS, `docker inspect ${imageTag}`);
    return info.Id;
  } catch {
    return undefined;
  }
}

/** Best-effort removal: leaves the image alone if it's still referenced (e.g. by a running container). */
export async function removeImageIfUnused(imageId: string): Promise<void> {
  try {
    await withTimeout(docker.getImage(imageId).remove({ force: false }), DOCKER_CALL_TIMEOUT_MS, "docker image rm");
  } catch {
    // still in use or already gone — nothing to do
  }
}

export async function stopInstallationContainer(containerName: string): Promise<void> {
  await removeContainerIfExists(containerName);
}

// Lifecycle actions on the EXISTING container (no remove/recreate, so the image and the
// config it was created with stay untouched). Resolves false when the container no longer
// exists, so the caller can fall back to a full deploy. The container's IP can change across a
// stop/start, hence the cache is dropped before and after.
async function actOnExistingContainer(
  containerName: string,
  what: string,
  timeoutMs: number,
  action: (container: Docker.Container) => Promise<unknown>,
): Promise<boolean> {
  ipCache.delete(containerName);
  try {
    await withTimeout(action(docker.getContainer(containerName)), timeoutMs, `docker ${what} ${containerName}`);
    return true;
  } catch (err) {
    if (isNotFoundError(err)) return false;
    // start on a running container / stop on a stopped one: already where we want it.
    if (isNotModifiedError(err)) return true;
    throw err;
  } finally {
    ipCache.delete(containerName);
  }
}

export const stopContainer = (containerName: string) =>
  actOnExistingContainer(containerName, "stop", DOCKER_STOP_TIMEOUT_MS, (c) => c.stop());

export const startContainer = (containerName: string) =>
  actOnExistingContainer(containerName, "start", DOCKER_CALL_TIMEOUT_MS, (c) => c.start());

export const restartContainer = (containerName: string) =>
  actOnExistingContainer(containerName, "restart", DOCKER_STOP_TIMEOUT_MS, (c) => c.restart());

async function lookupContainerIp(containerName: string): Promise<string> {
  const info = await withTimeout(
    docker.getContainer(containerName).inspect(),
    DOCKER_CALL_TIMEOUT_MS,
    `docker inspect ${containerName}`,
  );
  const network = info.NetworkSettings.Networks[config.mcpNetworkName];
  if (!network?.IPAddress) {
    throw new Error(`Container ${containerName} has no IP on network ${config.mcpNetworkName}`);
  }
  return network.IPAddress;
}

export function getContainerIp(containerName: string): Promise<string> {
  const cached = ipCache.get(containerName);
  if (cached && cached.expires > Date.now()) return cached.ip;

  // Concurrent callers share one in-flight lookup; failures aren't cached.
  const ip = lookupContainerIp(containerName);
  ipCache.set(containerName, { ip, expires: Date.now() + IP_CACHE_TTL_MS });
  ip.catch(() => {
    if (ipCache.get(containerName)?.ip === ip) ipCache.delete(containerName);
  });
  return ip;
}

export async function waitForContainerHealth(
  installation: Installation,
  timeoutMs = 20_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: Error | undefined;

  while (Date.now() < deadline) {
    try {
      const ip = await getContainerIp(installation.containerName);
      await new Promise<void>((resolve, reject) => {
        const socket = net.createConnection({ host: ip, port: installation.internalPort, timeout: 1000 });
        socket.once("connect", () => {
          socket.end();
          resolve();
        });
        socket.once("error", reject);
        socket.once("timeout", () => reject(new Error("connect timeout")));
      });
      return;
    } catch (err) {
      lastError = err as Error;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  throw new Error(
    `container did not start listening on ${installation.portEnvVar}=${installation.internalPort} within ${timeoutMs}ms` +
      (lastError ? ` (last error: ${lastError.message})` : ""),
  );
}
