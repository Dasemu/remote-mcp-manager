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

## Tests

```sh
npm test
```

Runs the `apps/server` unit test suite (vitest): the secrets encryption round-trip, the
Nixpacks runtime-version detection, the admin-session middleware, and the installations
state machine against a temporary SQLite DB. `.gitea/workflows/ci.yml` runs the same build
and test steps on every push, provided this repo's Gitea instance has Actions enabled with
a runner.

## Known limitations

- Nixpacks needs a dependency manifest (`requirements.txt`/`pyproject.toml` for Python,
  `package.json` for Node) in the installed repo. Repos without one will fail to build;
  the full build log is always visible in the UI to diagnose this.
- Every installed container gets the same memory/CPU caps (`CONTAINER_MEMORY_MB`,
  `CONTAINER_CPUS`), no per-installation override yet.
- No multi-user support — single operator only.
- Builds run one at a time.

See `LESSONS.md` for operational gotchas found while building and running this (Nixpacks
runtime-version mismatches, Podman networking, SELinux, etc.).
