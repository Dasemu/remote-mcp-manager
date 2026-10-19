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
