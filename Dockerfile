FROM docker:27-cli AS dockercli

FROM debian:12-slim AS nixpacks
# ghcr.io/railwayapp/nixpacks no longer ships the CLI binary in its image (repurposed
# upstream for something else) — pull the pinned release tarball from GitHub instead.
ARG NIXPACKS_VERSION=1.41.0
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && curl -fsSL -o /tmp/nixpacks.tar.gz \
    "https://github.com/railwayapp/nixpacks/releases/download/v${NIXPACKS_VERSION}/nixpacks-v${NIXPACKS_VERSION}-x86_64-unknown-linux-gnu.tar.gz" \
  && tar -xzf /tmp/nixpacks.tar.gz -C /usr/bin nixpacks \
  && rm /tmp/nixpacks.tar.gz

FROM node:20-slim AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY apps/server apps/server
COPY apps/web apps/web
RUN npm run build --workspace apps/web
RUN npm run build --workspace apps/server

FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends git openssh-client ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=nixpacks /usr/bin/nixpacks /usr/local/bin/nixpacks
COPY --from=dockercli /usr/local/bin/docker /usr/local/bin/docker
# nixpacks shells out to `docker build`, which defaults to BuildKit — needs the buildx
# plugin present or it fails with "BuildKit is enabled but the buildx component is missing".
COPY --from=dockercli /usr/local/libexec/docker/cli-plugins/docker-buildx /usr/local/libexec/docker/cli-plugins/docker-buildx

WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
RUN npm ci --omit=dev --workspace apps/server

COPY --from=build /repo/apps/server/dist apps/server/dist
COPY --from=build /repo/apps/web/dist apps/web/dist

WORKDIR /repo/apps/server
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/index.js"]
