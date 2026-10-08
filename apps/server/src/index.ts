import path from "node:path";
import express from "express";
import session from "express-session";
import { config } from "./config/env.js";
import "./db/index.js";
import { handleMcpProxyRequest } from "./proxy/mcpProxy.js";
import { authRouter } from "./api/auth.js";
import { installationsRouter } from "./api/installations.js";
import { requireAuth } from "./middleware/requireAuth.js";

if (!config.sessionSecret) {
  throw new Error("SESSION_SECRET env var must be set");
}

const app = express();
app.set("trust proxy", 1);
app.use(
  session({
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
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

app.get("/health", (_req, res) => res.json({ ok: true }));

// Bearer-token-gated MCP reverse proxy, public (auth handled per-installation).
app.all("/mcp/:slug", handleMcpProxyRequest);

// Scoped to /api only: a global express.json() would consume the request body of every
// request — including /mcp/:slug — before http-proxy gets a chance to forward it, leaving
// the proxied backend waiting forever for a body that already got drained. Confirmed on a
// real deploy: every proxied POST (i.e. every real MCP call) hung with zero bytes received.
app.use("/api", express.json());
app.use("/api/auth", authRouter);
app.use("/api/installations", requireAuth, installationsRouter);

const webDist = path.resolve(import.meta.dirname, "../../web/dist");
app.use(express.static(webDist));
app.get(/^\/(?!api|mcp|health).*/, (_req, res) => {
  res.sendFile(path.join(webDist, "index.html"), (err) => {
    if (err) res.status(404).end();
  });
});

app.listen(config.port, () => {
  console.log(`remote-mcp-manager listening on http://localhost:${config.port}`);
});
