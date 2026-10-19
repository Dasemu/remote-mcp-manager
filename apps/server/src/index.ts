import path from "node:path";
import express from "express";
import session from "express-session";
import { config } from "./config/env.js";
import { db } from "./db/index.js";
import { reconcileInterruptedInstallations } from "./db/installations.js";
import { getActiveProxyRequests, handleMcpProxyRequest } from "./proxy/mcpProxy.js";
import { authRouter } from "./api/auth.js";
import { installationsRouter } from "./api/installations.js";
import { systemRouter } from "./api/system.js";
import { collectSelfUpdateResult } from "./system/selfUpdate.js";
import { requireAuth } from "./middleware/requireAuth.js";
import { SqliteSessionStore } from "./session/sqliteStore.js";
import { startMemoryGuard } from "./service/memoryGuard.js";

if (!config.sessionSecret) {
  throw new Error("SESSION_SECRET env var must be set");
}

const interrupted = reconcileInterruptedInstallations();
if (interrupted > 0) console.warn(`marked ${interrupted} interrupted installation(s) as error after restart`);

const app = express();
app.set("trust proxy", 1);
app.use(
  session({
    store: new SqliteSessionStore(db),
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      // Lax: a cross-site form POST must not carry the session (e.g. to trigger a manager update).
      sameSite: "lax",
      // "auto": secure only if the request actually arrived over HTTPS (checks req.secure,
      // which respects "trust proxy" + X-Forwarded-Proto). A flat `NODE_ENV === "production"`
      // check meant the cookie was never stored at all when the admin panel is reached over
      // plain HTTP (e.g. direct to the container, or behind a proxy that doesn't terminate TLS
      // for it) — login would silently "succeed" but no session would ever persist.
      secure: "auto",
      maxAge: 1000 * 60 * 60 * 12,
    },
  }),
);

app.get("/health", (_req, res) => {
  const mem = process.memoryUsage();
  res.json({
    ok: true,
    uptimeSec: Math.round(process.uptime()),
    rssMb: Math.round(mem.rss / 1048576),
    heapUsedMb: Math.round(mem.heapUsed / 1048576),
    activeProxyRequests: getActiveProxyRequests(),
  });
});

// Bearer-token-gated MCP reverse proxy, public (auth handled per-installation).
app.all("/mcp/:slug", handleMcpProxyRequest);

// Scoped to /api only: a global express.json() would consume the request body of every
// request — including /mcp/:slug — before http-proxy gets a chance to forward it, leaving
// the proxied backend waiting forever for a body that already got drained. Confirmed on a
// real deploy: every proxied POST (i.e. every real MCP call) hung with zero bytes received.
app.use("/api", express.json());
app.use("/api/auth", authRouter);
app.use("/api/installations", requireAuth, installationsRouter);
app.use("/api/system", requireAuth, systemRouter);

const webDist = path.resolve(import.meta.dirname, "../../web/dist");
app.use(express.static(webDist));
app.get(/^\/(?!api|mcp|health).*/, (_req, res) => {
  res.sendFile(path.join(webDist, "index.html"), (err) => {
    if (err) res.status(404).end();
  });
});

const server = app.listen(config.port, () => {
  console.log(`remote-mcp-manager listening on http://localhost:${config.port}`);
});

// If an updater container ran just before this boot, pick up its outcome for the panel.
void collectSelfUpdateResult();

function shutdown(code: number): void {
  server.close(() => process.exit(code));
  server.closeAllConnections();
  setTimeout(() => process.exit(code), 5_000).unref();
}

process.on("SIGTERM", () => shutdown(0));
process.on("SIGINT", () => shutdown(0));

// Exit before a leak drags the whole host into swap; the container's restart policy
// (`unless-stopped`) starts a fresh process.
startMemoryGuard({
  limitMb: config.memoryLimitMb,
  onExceeded: (usedMb) => {
    console.error(
      `memory guard: heap+external at ${Math.round(usedMb)} MB exceeds MANAGER_MEMORY_LIMIT_MB=${config.memoryLimitMb}, restarting`,
    );
    shutdown(1);
  },
});
