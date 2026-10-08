import crypto from "node:crypto";
import type { Request, Response } from "express";
import httpProxy from "http-proxy";
import { getInstallationBySlug, type Installation } from "../db/installations.js";
import { getContainerIp } from "../docker/containers.js";

const proxy = httpProxy.createProxyServer();
proxy.on("error", (err, _req, res) => {
  if (!(res as Response).headersSent) {
    (res as Response).status(502).json({ error: "proxy error", detail: err.message });
  }
});

function stringsMatch(expected: string, provided: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function isAuthorized(installation: Installation, authHeader: string): boolean {
  if (authHeader.startsWith("Bearer ")) {
    const provided = authHeader.slice(7);
    return Boolean(installation.bearerToken) && stringsMatch(installation.bearerToken!, provided);
  }

  // Optional, per-installation: lets a client still using Basic Auth against the old nginx
  // setup keep its credentials instead of switching to a bearer token right away.
  if (authHeader.startsWith("Basic ") && installation.basicAuthUsername && installation.basicAuthPassword) {
    const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf8");
    const separatorIndex = decoded.indexOf(":");
    if (separatorIndex === -1) return false;
    const user = decoded.slice(0, separatorIndex);
    const pass = decoded.slice(separatorIndex + 1);
    return stringsMatch(installation.basicAuthUsername, user) && stringsMatch(installation.basicAuthPassword, pass);
  }

  return false;
}

export async function handleMcpProxyRequest(req: Request, res: Response): Promise<void> {
  const { slug } = req.params;
  const installation = getInstallationBySlug(slug);
  if (!installation || installation.status !== "running" || !installation.bearerToken) {
    res.status(404).json({ error: "unknown or unavailable installation" });
    return;
  }

  if (!isAuthorized(installation, req.get("authorization") ?? "")) {
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
