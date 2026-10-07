import express from "express";
import { config } from "./config/env.js";
import { handleMcpProxyRequest } from "./proxy/mcpProxy.js";

const app = express();

app.get("/health", (_req, res) => res.json({ ok: true }));

app.all("/mcp/:slug", handleMcpProxyRequest);

app.listen(config.port, () => {
  console.log(`remote-mcp-manager listening on http://localhost:${config.port}`);
});
