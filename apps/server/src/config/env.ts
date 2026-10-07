export const config = {
  port: Number(process.env.PORT ?? 3000),
  // Docker in prod; a rootless Podman socket (e.g. /run/user/<uid>/podman/podman.sock) in local dev.
  dockerSocketPath: process.env.DOCKER_SOCKET_PATH ?? "/var/run/docker.sock",
  mcpNetworkName: process.env.MCP_NETWORK_NAME ?? "mcp-net",
};
