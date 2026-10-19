import { describe, expect, it } from "vitest";
import { normalizeSha, parseCommitLog } from "./commits.js";

describe("normalizeSha", () => {
  it("accepts hex shas and lowercases them", () => {
    expect(normalizeSha("ABCDEF1234567")).toBe("abcdef1234567");
    expect(normalizeSha(" 5fb1d6b\n")).toBe("5fb1d6b");
  });

  it("rejects unknown, empty, too short and non-hex values", () => {
    for (const v of [undefined, "", "unknown", "abc12", "zzzzzzzz", "abc123; rm -rf /"]) {
      expect(normalizeSha(v)).toBeUndefined();
    }
  });
});

describe("parseCommitLog", () => {
  it("parses sha and subject, keeping tabs inside the subject", () => {
    const out = "a1b2c3d\tfeat: add thing\ne4f5a6b\tfix: a\tb\n";
    expect(parseCommitLog(out)).toEqual([
      { sha: "a1b2c3d", subject: "feat: add thing" },
      { sha: "e4f5a6b", subject: "fix: a\tb" },
    ]);
  });

  it("returns nothing for empty output", () => {
    expect(parseCommitLog("")).toEqual([]);
  });
});
