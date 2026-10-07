import crypto from "node:crypto";
import type { Request, Response } from "express";
import httpProxy from "http-proxy";
import { getInstallationBySlug } from "../db/installations.js";
import { getContainerIp } from "../docker/containers.js";

const proxy = httpProxy.createProxyServer();
proxy.on("error", (err, _req, res) => {
  if (!(res as Response).headersSent) {
    (res as Response).status(502).json({ error: "proxy error", detail: err.message });
  }
});

function tokensMatch(expected: string, provided: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function handleMcpProxyRequest(req: Request, res: Response): Promise<void> {
  const { slug } = req.params;
  const installation = getInstallationBySlug(slug);
  if (!installation || installation.status !== "running" || !installation.bearerToken) {
    res.status(404).json({ error: "unknown or unavailable installation" });
    return;
  }

  const authHeader = req.get("authorization") ?? "";
  const provided = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!provided || !tokensMatch(installation.bearerToken, provided)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  let targetIp: string;
  try {
    targetIp = await getContainerIp(installation.containerName);
  } catch (err) {
    res.status(502).json({ error: "installation unreachable", detail: (err as Error).message });
    return;
  }

  req.url = installation.httpPath;
  proxy.web(req, res, {
    target: `http://${targetIp}:${installation.internalPort}`,
    changeOrigin: true,
  });
}
