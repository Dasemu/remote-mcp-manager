# remote-mcp-manager

Self-hosted manager for MCP servers: install one from a GitHub repo URL, configure
its env vars, build it with [Nixpacks](https://nixpacks.com) (no Dockerfile needed
in the source repo), run it in a container, and get back an authenticated
`https://<your-domain>/mcp/<slug>` URL guarded by a bearer token.

## Quick start (production, Docker)

```sh
cp .env.example .env   # fill in ADMIN_PASSWORD, SESSION_SECRET, MASTER_KEY, PUBLIC_BASE_URL
docker compose up -d --build
```

Put your own reverse proxy (nginx, etc.) in front of port 3000 for TLS and your public domain.

## Local development (Podman)

Requires `nixpacks` and a `docker` CLI pointed at your Podman socket (e.g. via the
`podman-docker` package) on your PATH.

```sh
npm install
DOCKER_SOCKET_PATH=/run/user/$(id -u)/podman/podman.sock \
DATA_DIR=./data MASTER_KEY=... SESSION_SECRET=... ADMIN_PASSWORD=... \
  npm run dev:server
```

Because rootless Podman isolates the host network namespace from the container bridge,
the manager itself must run as a container attached to `mcp-net` to reach the MCP
containers it manages — running it directly on the host only works for routes that
don't need to reach a sibling container (e.g. `/health`, `/api/auth`).

## Known limitations

- Nixpacks needs a dependency manifest (`requirements.txt`/`pyproject.toml` for Python,
  `package.json` for Node) in the installed repo. Repos without one will fail to build;
  the full build log is always visible in the UI to diagnose this.
- No per-container resource limits, image garbage collection, or multi-user support yet.
- Builds run one at a time.
