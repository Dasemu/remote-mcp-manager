import crypto from "node:crypto";
import { Router } from "express";
import { config } from "../config/env.js";

export const authRouter = Router();

function passwordsMatch(expected: string, provided: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

let failedAttempts = 0;
let lockoutUntil = 0;

authRouter.post("/login", (req, res) => {
  if (Date.now() < lockoutUntil) {
    res.status(429).json({ error: "too many attempts, try again later" });
    return;
  }

  const { password } = req.body ?? {};
  if (!config.adminPassword) {
    res.status(500).json({ error: "ADMIN_PASSWORD is not configured" });
    return;
  }

  if (typeof password !== "string" || !passwordsMatch(config.adminPassword, password)) {
    failedAttempts += 1;
    if (failedAttempts >= 5) {
      lockoutUntil = Date.now() + 60_000;
      failedAttempts = 0;
    }
    res.status(401).json({ error: "invalid password" });
    return;
  }

  failedAttempts = 0;
  req.session.authenticated = true;
  res.json({ ok: true });
});

authRouter.post("/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

authRouter.get("/session", (req, res) => {
  res.json({ authenticated: Boolean(req.session.authenticated) });
});
