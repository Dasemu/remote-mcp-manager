import path from "node:path";

const dataDir = process.env.DATA_DIR ?? path.resolve(process.cwd(), "../../data");

export const config = {
  port: Number(process.env.PORT ?? 3000),
  // Docker in prod; a rootless Podman socket (e.g. /run/user/<uid>/podman/podman.sock) in local dev.
  dockerSocketPath: process.env.DOCKER_SOCKET_PATH ?? "/var/run/docker.sock",
  mcpNetworkName: process.env.MCP_NETWORK_NAME ?? "mcp-net",
  dataDir,
  dbPath: process.env.DB_PATH ?? path.join(dataDir, "db.sqlite"),
  reposDir: path.join(dataDir, "repos"),
  logsDir: path.join(dataDir, "logs"),
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`,
  adminPassword: process.env.ADMIN_PASSWORD,
  sessionSecret: process.env.SESSION_SECRET,
  // Per-container resource caps, applied to every installation (no per-installation override in V1).
  containerMemoryMb: Number(process.env.CONTAINER_MEMORY_MB ?? 512),
  containerCpus: Number(process.env.CONTAINER_CPUS ?? 1),
};
