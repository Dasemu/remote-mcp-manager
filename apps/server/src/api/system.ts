import { Router } from "express";
import { getSystemInfo, refreshRemoteStatus, startSelfUpdate, SelfUpdateError } from "../system/selfUpdate.js";

export const systemRouter = Router();

systemRouter.get("/", async (_req, res) => {
  res.json(await getSystemInfo());
});

systemRouter.post("/check", async (_req, res) => {
  await refreshRemoteStatus();
  res.json(await getSystemInfo());
});

systemRouter.post("/update", async (_req, res) => {
  try {
    await startSelfUpdate();
    res.status(202).json({ ok: true });
  } catch (err) {
    res.status(err instanceof SelfUpdateError ? err.status : 500).json({ error: (err as Error).message });
  }
});
