# Architecture

## Components

- **`apps/server`** — Express + TypeScript API and proxy. Owns the SQLite DB
  (`apps/server/src/db`), the Docker/Podman control plane (`apps/server/src/docker`), the
  Nixpacks build pipeline (`apps/server/src/build`), secret encryption
  (`apps/server/src/crypto`), and the authenticated reverse proxy to installed MCP
  containers (`apps/server/src/proxy`).
- **`apps/web`** — React + Vite single-page admin panel (install wizard, installation list
  and detail views, login).

## Installation lifecycle

1. Operator submits a repo URL (+ optional git ref) through the web UI.
2. `apps/server/src/service/orchestrator.ts` clones (or updates) the repo, detects env vars
   from its `.env.example`, and creates a draft `Installation` row.
3. On build, the repo is (re-)cloned and built with Nixpacks
   (`apps/server/src/build/nixpacks.ts`) into a Docker image.
4. The image is run as a sibling container attached to the shared `mcp-net` Docker network
   (`apps/server/src/docker/containers.ts`), with the resource caps from `CONTAINER_MEMORY_MB`
   / `CONTAINER_CPUS`.
5. Requests to `/mcp/<slug>` are authenticated against the installation's bearer token
   (`apps/server/src/proxy/mcpProxy.ts`, constant-time comparison) and proxied to the
   container's IP on the shared network.

## Why the manager itself must run as a container

Rootless Podman isolates the host network namespace from the container bridge, so the
manager can only reach sibling MCP containers (by IP on `mcp-net`) when it is itself
attached to that network — running it directly on the host only works for routes that
don't need to reach a sibling container (e.g. `/health`, `/api/auth`). See the README's
"Local development (Podman)" section and `LESSONS.md` for the operational detail.
