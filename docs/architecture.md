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

## Start / Stop / Restart vs Deploy

Two families of actions, both in `apps/server/src/service/orchestrator.ts`:

- **Build / Deploy** change what runs. Build re-clones the repo and produces a new image
  (the running container is untouched). Deploy removes any existing container and creates a
  new one from the built image, so it is the only way to apply changed env/config.
  "Redeploy (env only)" is Deploy again with the current image; "Rebuild & redeploy" is Build
  then Deploy (and stops before deploying if the build fails).
- **Start / Stop / Restart** only change whether the *existing* container runs
  (`docker stop|start|restart`; nothing is removed or recreated, so they are fast and never
  apply new env/config). Stop sets status `stopped`; the container's `unless-stopped` restart
  policy keeps it stopped until started. Start and Restart set `starting`, wait for the
  container to listen (same health check as Deploy), then `running` (or `error` with the
  reason). If the container no longer exists they fall back to Deploy when the installation
  has a built image, and report an error otherwise.

A build never touches the running container, so an installation that is `running` stays
`running` (and served) during and after a build, even a failed one; the failure shows in the
status detail. The proxy only serves installations in status `running`, so a stopped or restarting
installation answers 404 until it is healthy again. The per-container IP cache is dropped on
every start/stop/restart because the IP can change.

## Why the manager itself must run as a container

Rootless Podman isolates the host network namespace from the container bridge, so the
manager can only reach sibling MCP containers (by IP on `mcp-net`) when it is itself
attached to that network — running it directly on the host only works for routes that
don't need to reach a sibling container (e.g. `/health`, `/api/auth`). See the README's
"Local development (Podman)" section and `LESSONS.md` for the operational detail.

## Self-update

`system/selfUpdate.ts` (state, clone + build in the shared build queue, hand-over) and
`system/selfUpdateHelper.ts` (the updater container's entry point: swap, health check, rollback)
implement the panel's *Update manager* button, exposed as `GET /api/system` and
`POST /api/system/update` behind `requireAuth`. See `docs/operations.md`.
`system/remoteCheck.ts` compares the installed commit (`GIT_SHA`) with the remote head to show how many
commits behind the manager is.
