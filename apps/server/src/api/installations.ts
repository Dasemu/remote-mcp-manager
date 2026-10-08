import { Router } from "express";
import { config } from "../config/env.js";
import {
  type Installation,
  listInstallations,
  getInstallationById,
  deleteInstallation,
  updateInstallation,
} from "../db/installations.js";
import {
  createDraftInstallation,
  configureInstallation,
  buildInstallation,
  deployInstallation,
  redeployInstallation,
  removeInstallationContainer,
} from "../service/orchestrator.js";
import { buildLogPath } from "../build/nixpacks.js";
import { generateBearerToken } from "../crypto/secrets.js";
import fs from "node:fs";

export const installationsRouter = Router();

// Not masked: this API sits behind single-operator session auth (requireAuth), and the
// operator is the same person who owns these secrets — editing them requires seeing them.
function toPublicJson(installation: Installation) {
  return {
    ...installation,
    publicUrl: `${config.publicBaseUrl}/mcp/${installation.slug}`,
  };
}

installationsRouter.get("/", (_req, res) => {
  res.json(listInstallations().map(toPublicJson));
});

installationsRouter.get("/:id", (req, res) => {
  const installation = getInstallationById(req.params.id);
  if (!installation) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json(toPublicJson(installation));
});

installationsRouter.post("/", async (req, res) => {
  const { name, repoUrl, gitRef } = req.body ?? {};
  if (!name || !repoUrl) {
    res.status(400).json({ error: "name and repoUrl are required" });
    return;
  }
  try {
    const { installation, detectedEnvKeys } = await createDraftInstallation({ name, repoUrl, gitRef });
    res.status(201).json({ installation: toPublicJson(installation), detectedEnvKeys });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

installationsRouter.patch("/:id/config", (req, res) => {
  const { env, portEnvVar, hostEnvVar, httpPath, internalPort, basicAuthUsername, basicAuthPassword, startCommand } =
    req.body ?? {};
  try {
    const installation = configureInstallation(req.params.id, {
      env,
      portEnvVar,
      hostEnvVar,
      httpPath,
      internalPort,
      basicAuthUsername,
      basicAuthPassword,
      startCommand,
    });
    res.json(toPublicJson(installation));
  } catch (err) {
    res.status(404).json({ error: (err as Error).message });
  }
});

installationsRouter.post("/:id/build", async (req, res) => {
  try {
    const installation = await buildInstallation(req.params.id);
    res.json(toPublicJson(installation));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

installationsRouter.post("/:id/deploy", async (req, res) => {
  try {
    const installation = await deployInstallation(req.params.id);
    res.json(toPublicJson(installation));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

installationsRouter.post("/:id/redeploy", async (req, res) => {
  const rebuild = Boolean(req.body?.rebuild);
  try {
    const installation = await redeployInstallation(req.params.id, { rebuild });
    res.json(toPublicJson(installation));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

installationsRouter.get("/:id/logs", (req, res) => {
  const installation = getInstallationById(req.params.id);
  if (!installation) {
    res.status(404).json({ error: "not found" });
    return;
  }

  const dir = `${config.logsDir}/${installation.slug}`;
  if (!fs.existsSync(dir)) {
    res.json({ log: "" });
    return;
  }
  const files = fs.readdirSync(dir).sort();
  const latest = files.at(-1);
  if (!latest) {
    res.json({ log: "" });
    return;
  }
  res.json({ log: fs.readFileSync(buildLogPath(installation.slug, latest.replace(/\.log$/, "")), "utf8") });
});

installationsRouter.delete("/:id", async (req, res) => {
  try {
    await removeInstallationContainer(req.params.id);
    deleteInstallation(req.params.id);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

installationsRouter.post("/:id/regenerate-token", (req, res) => {
  try {
    const installation = updateInstallation(req.params.id, { bearerToken: generateBearerToken() });
    res.json({ bearerToken: installation.bearerToken });
  } catch (err) {
    res.status(404).json({ error: (err as Error).message });
  }
});
