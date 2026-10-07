import net from "node:net";
import Docker from "dockerode";
import { config } from "../config/env.js";
import type { Installation } from "../db/installations.js";

const docker = new Docker({ socketPath: config.dockerSocketPath });

export async function ensureNetwork(name: string): Promise<void> {
  const networks = await docker.listNetworks({ filters: { name: [name] } });
  if (networks.length === 0) {
    await docker.createNetwork({ Name: name, Driver: "bridge" });
  }
}

export async function removeContainerIfExists(containerName: string): Promise<void> {
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

  const env = {
    ...installation.env,
    [installation.portEnvVar]: String(installation.internalPort),
    [installation.hostEnvVar]: "0.0.0.0",
  };

  const container = await docker.createContainer({
    name: installation.containerName,
    Image: installation.imageTag,
    Env: Object.entries(env).map(([k, v]) => `${k}=${v}`),
    HostConfig: {
      RestartPolicy: { Name: "unless-stopped" },
      NetworkMode: config.mcpNetworkName,
    },
  });

  await container.start();
  return container.id;
}

export async function stopInstallationContainer(containerName: string): Promise<void> {
  await removeContainerIfExists(containerName);
}

export async function getContainerIp(containerName: string): Promise<string> {
  const container = docker.getContainer(containerName);
  const info = await container.inspect();
  const network = info.NetworkSettings.Networks[config.mcpNetworkName];
  if (!network?.IPAddress) {
    throw new Error(`Container ${containerName} has no IP on network ${config.mcpNetworkName}`);
  }
  return network.IPAddress;
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
