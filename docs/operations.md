# Operations

## Memory and resource safeguards

The manager runs on the same (often small) host as every MCP container, so a runaway manager
degrades all of them. After an incident where the manager's Node process grew to ~1.1 GiB
(RAM + swap), held ~70 stuck connections to port 3000 and pushed the host into swap, these
limits exist:

| Safeguard | Where | Behaviour |
|---|---|---|
| Proxy inactivity timeout | `PROXY_TIMEOUT_MS` (default 300000) | A stalled upstream or vanished client is cut after this much silence, freeing its sockets and buffers. |
| Concurrent proxy cap | `MAX_PROXY_REQUESTS` (default 100) | Beyond it `/mcp/<slug>` answers `503` + `Retry-After` instead of queueing without bound. |
| Docker call timeout + IP cache | `docker/containers.ts` | `docker inspect` times out after 10 s and the container IP is cached for 5 s, so a wedged Docker daemon cannot stall every request at once. |
| Session store | `session/sqliteStore.ts` | Sessions live in the SQLite DB and expired ones are purged every 10 min. Replaces `MemoryStore`, which never evicts and warned it leaks in production. |
| Memory guard | `MANAGER_MEMORY_LIMIT_MB` (default 512, 0 = off) | Checked every 30 s on heap + external memory (not RSS, which hides swapped pages). When exceeded the process exits and `restart: unless-stopped` starts a fresh one. |
| V8 heap ceiling | `NODE_OPTIONS=--max-old-space-size=768` in the `Dockerfile` | Hard backstop above the soft limit. |
| Serialized builds | `service/orchestrator.ts` | One Nixpacks/Docker build at a time; git is killed after 5 min and a build after 30 min (the whole process group, so a hung `docker build` can't keep the queue blocked). |
| Restart reconciliation | `reconcileInterruptedInstallations` | On boot, `cloning`/`building`/`starting` installations are marked `error` (Start or Redeploy recovers them), since the process that was advancing them is gone. |

A container-level cgroup limit on the manager (`mem_limit` in compose) would be the strongest
guard, but it fails outright on hosts that do not delegate cgroup controllers (see
`LESSONS.md`), so the limits above are enforced inside the process instead. Add `mem_limit`
yourself on hosts that support it.

## Checking on it

`GET /health` (unauthenticated) returns `ok`, `uptimeSec`, `rssMb`, `heapUsedMb` and
`activeProxyRequests`. A heap that keeps climbing between restarts, or an
`activeProxyRequests` that stays high with no traffic, points at a leak. A line
`memory guard: ... restarting` in the manager's log means the guard fired.

## Updating the manager from the panel

The **Manager** card on the installations page has an *Update manager* button. It is enabled when
`SELF_UPDATE_REPO_URL` is set (operator-only env var, never taken from a request) and the manager
runs in a container whose id it can inspect (production compose; not local `npm run dev`).

Flow:

1. In the serial build queue (so it never overlaps an installation build) the manager clones
   `SELF_UPDATE_REPO_URL` at `SELF_UPDATE_REF` (default `master`) and runs `docker build` on it.
   Refused with `409` if an installation is cloning/building/starting.
2. It starts a short-lived **updater container** from the *new* image
   (`node dist/system/selfUpdateHelper.js`, label `remote-mcp-manager.self-update-helper`). A
   manager cannot replace itself: stopping its own container kills the code doing it.
3. The updater stops the old manager, renames it `<name>-pre-update`, creates a replacement with
   the same name, bind mounts, port bindings, network aliases, restart policy, labels and operator
   env (`buildReplacementSpec`), but the new image's own `Cmd` and image `ENV`, and polls
   `/health` for up to 90 s.
4. Healthy: the old container and image are removed. Not healthy: the replacement is removed and
   the old container is renamed back and started (rollback). Exit code 0 = updated, 1 = rolled
   back, 2 = fatal.
5. The (new or restored) manager reads the exited updater's logs at the next `GET /api/system`,
   shows the outcome in the card, and removes the updater container.

Expect a few seconds of downtime while the containers swap; the panel keeps polling and reconnects
on its own. The sessions live in SQLite under `./data`, so the login survives. Compose still sees
the replacement as its `manager` service (labels are copied); a later `docker compose up -d --build`
works as usual. The checkout is kept in `data/repos/_manager` and logs in `data/logs/_manager/`.
Over `ssh://` the clone uses the mounted `SSH_DIR`, like installations do.

Caveats: installation changes (build, deploy, start, stop...) answer `409` while an update is in
progress, and the hand-over runs inside the build queue, so no installation build overlaps it. The
updater removes the old manager image after a successful swap, so before running `docker compose
up -d --build` on the host again, `git pull` its checkout first or compose will rebuild (and
deploy) an older version than the one installed from the panel.
