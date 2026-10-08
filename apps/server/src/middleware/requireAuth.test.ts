import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { requireAuth } from "./requireAuth.js";

function mockRes() {
  const res = {} as Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("requireAuth", () => {
  it("calls next when the session is authenticated", () => {
    const req = { session: { authenticated: true } } as unknown as Request;
    const res = mockRes();
    const next = vi.fn();

    requireAuth(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("rejects with 401 when the session is not authenticated", () => {
    const req = { session: {} } as unknown as Request;
    const res = mockRes();
    const next = vi.fn();

    requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "authentication required" });
  });
});
