import fs from "node:fs";
import path from "node:path";

// VERSION sits at the repo root, four levels above this file in both the image and a checkout:
// <root>/apps/server/{src,dist}/system/version.*
const versionFile = path.resolve(import.meta.dirname, "../../../../VERSION");

export function readVersion(): string {
  try {
    return fs.readFileSync(versionFile, "utf8").trim() || "unknown";
  } catch {
    return "unknown";
  }
}
