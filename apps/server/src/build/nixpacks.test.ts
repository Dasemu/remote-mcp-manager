import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectNodeVersion } from "./nixpacks.js";

function mkTmpRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "nixpacks-test-"));
}

describe("detectNodeVersion", () => {
  it("reads the major version from .nvmrc", () => {
    const dir = mkTmpRepo();
    fs.writeFileSync(path.join(dir, ".nvmrc"), "20.11.0\n");
    expect(detectNodeVersion(dir)).toBe("20");
  });

  it("prefers .nvmrc over package.json when both are present", () => {
    const dir = mkTmpRepo();
    fs.writeFileSync(path.join(dir, ".nvmrc"), "18\n");
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ engines: { node: ">=22" } }));
    expect(detectNodeVersion(dir)).toBe("18");
  });

  it("falls back to package.json engines.node", () => {
    const dir = mkTmpRepo();
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ engines: { node: ">=20.0.0" } }));
    expect(detectNodeVersion(dir)).toBe("20");
  });

  it("returns undefined when there is no version hint", () => {
    const dir = mkTmpRepo();
    expect(detectNodeVersion(dir)).toBeUndefined();
  });

  it("returns undefined for malformed package.json instead of throwing", () => {
    const dir = mkTmpRepo();
    fs.writeFileSync(path.join(dir, "package.json"), "{not valid json");
    expect(detectNodeVersion(dir)).toBeUndefined();
  });
});
