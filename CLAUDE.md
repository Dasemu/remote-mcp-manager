# CLAUDE.md

## Overview
Self-hosted manager for MCP servers: install one from a GitHub repo URL, build it with
Nixpacks, run it in a container, and expose it at an authenticated `/mcp/<slug>` URL.
npm workspaces monorepo: `apps/server` (Express + TypeScript API) and `apps/web` (React + Vite UI).

## Commands
- Install: `npm install`
- Dev (server): `npm run dev:server`
- Dev (web): `npm run dev --workspace apps/web`
- Test: `npm test` (runs `apps/server`'s vitest suite; `apps/web` has no tests yet)
- Build (server): `npm run build --workspace apps/server`
- Build (web): `npm run build --workspace apps/web`
- Lint: none configured — CI type-checks via each workspace's build (`tsc`)

## Architecture
Operator installs an MCP server from a repo URL; the server clones it, builds it with
Nixpacks, runs it as a sibling container on a shared Docker network (`mcp-net`), and proxies
authenticated requests to it. See `README.md` for the full flow and `docs/` for details.

## Conventions
- TypeScript, strict mode, ES modules (`type: "module"`) in both workspaces.
- Tests live next to the code as `*.test.ts`, run with vitest.
- Secrets (env vars, bearer tokens) are encrypted at rest with AES-256-GCM (`apps/server/src/crypto/secrets.ts`).

## Workflow quirks
- This repo is hosted on Gitea; CI workflows live in `.gitea/workflows/`, not `.github/workflows/`.
- Local dev requires Podman with a `docker`-compatible socket (see README) because the manager
  itself must run as a container attached to `mcp-net` to reach sibling MCP containers.

## Deployment
- Production: `docker compose up -d --build` behind your own reverse proxy for TLS (see README).
- See `LESSONS.md` before touching the build/container pipeline — several non-obvious gotchas
  (Nixpacks binary extraction, BuildKit/buildx, cgroup delegation) are recorded there.

## Gotchas
- Builds run one at a time; no per-installation resource override (see README "Known limitations").
- `.gitea/workflows/ci.yml` only runs if this repo's Gitea instance has Actions enabled with a runner.
