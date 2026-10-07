FROM ghcr.io/railwayapp/nixpacks:1.41.0 AS nixpacks
FROM docker:27-cli AS dockercli

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
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=nixpacks /usr/bin/nixpacks /usr/local/bin/nixpacks
COPY --from=dockercli /usr/local/bin/docker /usr/local/bin/docker

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
