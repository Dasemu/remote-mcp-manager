# Lessons

Recurring mistakes and gotchas found while building and operating this project, and how to avoid or work around them.

## A pinned external image's *contents* can still change

The Dockerfile pinned `ghcr.io/railwayapp/nixpacks:1.41.0` and copied `/usr/bin/nixpacks` out
of it. That path existed when the plan was written but was gone by the time of the first
real production deploy — the image got repurposed upstream (now ships a Nix daemon, not the
nixpacks CLI) even though the tag `1.41.0` still resolves.

**Avoid it:** pinning a tag is not enough to guarantee what's inside an externally-published
image stays the same — only pinning by digest guarantees bytes. For a single binary like this,
prefer downloading the pinned release asset directly from the project's GitHub releases (a
specific `vX.Y.Z` tag + exact filename) over extracting it from someone else's Docker image.

## `git clone ssh://...` needs an actual `ssh` binary, and a key

`node:20-slim` ships `git` but not `openssh-client` — cloning an `https://` repo works, but
`ssh://` fails with "cannot run ssh: No such file or directory". Fixed by installing
`openssh-client` in the final image. Separately, even with `ssh` present, cloning a private
repo needs a key with access mounted into the container (`SSH_DIR` in `docker-compose.yml`,
reusing the host's own deploy key) — confirmed both failures back to back while deploying.

## `docker build` needs the buildx plugin present to use BuildKit

Nixpacks shells out to `docker build`, which defaults to BuildKit. The manager's image only
copied the bare `docker` CLI binary from `docker:27-cli`, not its buildx plugin, so every
build failed with "BuildKit is enabled but the buildx component is missing or broken" —
confirmed on the first real build attempt. Fixed by also copying
`/usr/local/libexec/docker/cli-plugins/docker-buildx` from the same `docker:27-cli` image.

## Per-container memory/CPU cgroup limits need the host to delegate controllers

`docker run --memory=...` fails outright ("error setting cgroup config... memory.max: no
such file or directory") on a host where `cgroup.subtree_control` isn't populated down to
where the container's cgroup lives. Confirmed on an unprivileged, OpenRC-based nested LXC
(Alpine, no systemd) with `nesting=1`: systemd normally does this delegation automatically
at boot; OpenRC doesn't, so `cgroup.subtree_control` stays empty at the LXC's own root and
no controller is ever available to nested Docker containers. `CONTAINER_MEMORY_MB`/
`CONTAINER_CPUS` can both be set to `0` to skip asking for a cap at all — on a host like this
the outer LXC's own memory limit (if Proxmox/systemd-nspawn/etc. sets one) is the only
enforced ceiling either way. Properly fixing the delegation means moving every process
already in the LXC's root cgroup into a leaf scope and then writing the wanted controllers
to the root's `cgroup.subtree_control` — not done here, since it's a live production LXC and
restructuring its cgroup tree wasn't something to risk without asking first.

## Nixpacks silently picks its own default runtime version

Nixpacks does not fail when a repo's `engines`/version requirement isn't met — it silently falls back to its own default (e.g. picked Node 18 for a repo requiring Node >=20 in `Social-MCP`). The build goes green, then the container crashes at runtime (`crypto is not defined`, missing globals, etc.).

**Avoid it:** don't trust a green build as proof the runtime is correct. The manager now detects a Node version hint from the repo itself (`.nvmrc`, else `package.json` `engines.node`) and passes it to Nixpacks as `NIXPACKS_NODE_VERSION` (`apps/server/src/build/nixpacks.ts`, `detectNodeVersion`), so the build uses the version the repo actually declares instead of Nixpacks' own default. Repos with no version hint at all still get Nixpacks' default, unchanged.

## Nixpacks needs a dependency manifest, and fails cleanly without one

No `requirements.txt`/`pyproject.toml` (Python) or `package.json` (Node) in the installed repo → Nixpacks fails with "Nixpacks was unable to generate a build plan" (exit 1). This is expected and not something the manager works around generically — several of the user's own Python MCPs lack a manifest entirely.

**Avoid it:** always surface the full build log in the UI so this failure is immediately diagnosable; don't try to add generic manifest-inference logic.

## Piped exit codes mask the real command result

Piping a subprocess's output through another command (e.g. `| tee`) loses the original exit code in `$?`. This hid a real nixpacks build failure during manual testing.

**Avoid it:** redirect output straight to a file and check `$?` immediately after the command, don't pipe when the exit code matters.

## Rootless Podman isolates the host network namespace from the container bridge

The host cannot reach a container's bridge-network IP directly under rootless Podman (netavark backend, `"isolate": "true"`). Only another container on the same network can reach it.

**Avoid it:** for local dev, run the manager itself as a container attached to `mcp-net` — this also matches the production topology, where the manager runs as a container too.

## SELinux can deny access to a bind-mounted socket even with matching UID/GID

Got an `EACCES` on the Podman socket despite `--userns=keep-id` lining up UID/GID. Root cause was an SELinux AVC denial in enforcing mode, not a permissions issue.

**Avoid it:** when socket access fails despite correct ownership, check `audit.log`/`ausearch` for AVC denials before chasing permissions further. `--security-opt label=disable` confirms the diagnosis but is not a production fix — use a proper SELinux policy/context instead.

## Podman images must be referenced fully-qualified

A short image name wasn't enough to remove an image via the Docker-compatible socket under Podman — needed the fully-qualified `localhost/...` name.

**Avoid it:** always use the fully-qualified name dockerode/the Docker API returns, don't assume short names round-trip.

## npm workspaces hoist node_modules to the repo root

Mounting only `apps/server` into a test container produced `node_modules not found` — the hoisted root `node_modules` wasn't mounted.

**Avoid it:** mount the whole repo root when testing a workspace package, not just its subdirectory.
