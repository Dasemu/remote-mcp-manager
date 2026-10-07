import Docker from "dockerode";
import { config } from "../config/env.js";
import type { Installation } from "../installations.js";

const docker = new Docker({ socketPath: config.dockerSocketPath });

export async function ensureNetwork(name: string): Promise<void> {
  const networks = await docker.listNetworks({ filters: { name: [name] } });
  if (networks.length === 0) {
    await docker.createNetwork({ Name: name, Driver: "bridge" });
  }
}

export async function runInstallationContainer(installation: Installation): Promise<void> {
  await ensureNetwork(config.mcpNetworkName);

  const existing = docker.getContainer(installation.containerName);
  try {
    await existing.remove({ force: true });
  } catch {
    // container didn't exist yet, nothing to clean up
  }

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
