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
  // Safeguards so one stuck upstream or a runaway heap can't take the whole host down.
  // Inactivity timeout for proxied MCP requests/streams; a stalled upstream is cut after this.
  proxyTimeoutMs: Number(process.env.PROXY_TIMEOUT_MS ?? 300_000),
  // Max simultaneous proxied requests; beyond this the proxy answers 503 instead of piling up.
  maxProxyRequests: Number(process.env.MAX_PROXY_REQUESTS ?? 100),
  // The manager exits (and the container restart policy brings it back) once its own
  // heap + external memory exceeds this. 0 disables the guard.
  memoryLimitMb: Number(process.env.MANAGER_MEMORY_LIMIT_MB ?? 512),
  // Self-update: git repo/ref the manager rebuilds itself from. Operator-set only (never taken
  // from a request); without a repo URL the panel's "Update manager" button is disabled.
  selfUpdateRepoUrl: process.env.SELF_UPDATE_REPO_URL || undefined,
  selfUpdateRef: process.env.SELF_UPDATE_REF || "master",
};
