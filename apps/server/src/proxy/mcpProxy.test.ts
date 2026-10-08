import { describe, expect, it } from "vitest";
import { isAuthorized } from "./mcpProxy.js";
import type { Installation } from "../db/installations.js";

function makeInstallation(overrides: Partial<Installation> = {}): Installation {
  return {
    id: "1",
    slug: "test",
    name: "Test",
    repoUrl: "https://example.com/repo.git",
    gitRef: null,
    status: "running",
    statusDetail: null,
    imageTag: "mcpmgr/test:latest",
    containerId: null,
    containerName: "mcp-test",
    internalPort: 8080,
    httpPath: "/mcp",
    portEnvVar: "PORT",
    hostEnvVar: "HOST",
    env: {},
    bearerToken: "secret-token",
    basicAuthUsername: null,
    basicAuthPassword: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("isAuthorized", () => {
  it("accepts a matching bearer token", () => {
    expect(isAuthorized(makeInstallation(), "Bearer secret-token")).toBe(true);
  });

  it("rejects a wrong bearer token", () => {
    expect(isAuthorized(makeInstallation(), "Bearer wrong")).toBe(false);
  });

  it("rejects basic auth when no credentials are configured", () => {
    const creds = Buffer.from("user:pass").toString("base64");
    expect(isAuthorized(makeInstallation(), `Basic ${creds}`)).toBe(false);
  });

  it("accepts matching basic auth when credentials are configured", () => {
    const installation = makeInstallation({ basicAuthUsername: "user", basicAuthPassword: "pass" });
    const creds = Buffer.from("user:pass").toString("base64");
    expect(isAuthorized(installation, `Basic ${creds}`)).toBe(true);
  });

  it("rejects wrong basic auth credentials", () => {
    const installation = makeInstallation({ basicAuthUsername: "user", basicAuthPassword: "pass" });
    const creds = Buffer.from("user:wrong").toString("base64");
    expect(isAuthorized(installation, `Basic ${creds}`)).toBe(false);
  });

  it("rejects when no Authorization header is present", () => {
    expect(isAuthorized(makeInstallation(), "")).toBe(false);
  });
});
