import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// db/index.ts opens the sqlite file as a side effect of being imported, using config
// derived from DATA_DIR/DB_PATH — so these must be set before the dynamic import below.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcpmgr-db-test-"));
process.env.DATA_DIR = tmpDir;
process.env.DB_PATH = path.join(tmpDir, "db.sqlite");
process.env.MASTER_KEY = "test-master-key-at-least-32-characters-long";

const { createInstallation, updateInstallation, getInstallationById, slugify } = await import("./installations.js");

describe("slugify", () => {
  it("normalizes names into a URL/container-safe slug", () => {
    expect(slugify("My Cool MCP!")).toBe("my-cool-mcp");
  });
});

describe("installations repository", () => {
  it("creates a draft installation with a derived container name", () => {
    const installation = createInstallation({
      name: "Test MCP",
      slug: "test-mcp",
      repoUrl: "https://example.com/repo.git",
    });

    expect(installation.status).toBe("draft");
    expect(installation.containerName).toBe("mcp-test-mcp");
  });

  it("persists status transitions", () => {
    const installation = createInstallation({
      name: "State MCP",
      slug: "state-mcp",
      repoUrl: "https://example.com/repo.git",
    });

    updateInstallation(installation.id, { status: "building" });
    updateInstallation(installation.id, { status: "built", imageTag: "mcpmgr/state-mcp:latest" });
    const final = updateInstallation(installation.id, { status: "running", bearerToken: "secret-token" });

    expect(final.status).toBe("running");
    expect(final.imageTag).toBe("mcpmgr/state-mcp:latest");
    expect(getInstallationById(installation.id)?.status).toBe("running");
  });

  it("round-trips encrypted env vars", () => {
    const installation = createInstallation({
      name: "Env MCP",
      slug: "env-mcp",
      repoUrl: "https://example.com/repo.git",
    });

    const updated = updateInstallation(installation.id, { env: { FOO: "bar", API_KEY: "shh" } });

    expect(updated.env).toEqual({ FOO: "bar", API_KEY: "shh" });
    expect(getInstallationById(installation.id)?.env).toEqual({ FOO: "bar", API_KEY: "shh" });
  });
});
