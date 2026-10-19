import { describe, expect, it } from "vitest";
import { demuxLogs } from "./dockerLogs.js";

function frame(stream: number, text: string): Buffer {
  const payload = Buffer.from(text);
  const header = Buffer.alloc(8);
  header[0] = stream;
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

describe("demuxLogs", () => {
  it("joins stdout and stderr frames in order", () => {
    const buf = Buffer.concat([frame(1, "hello "), frame(2, "world\n")]);
    expect(demuxLogs(buf)).toBe("hello world\n");
  });

  it("returns an empty string for empty or header-only input", () => {
    expect(demuxLogs(Buffer.alloc(0))).toBe("");
    expect(demuxLogs(Buffer.alloc(4))).toBe("");
  });

  it("does not read past a truncated frame", () => {
    const buf = frame(1, "abcdef").subarray(0, 8 + 3);
    expect(demuxLogs(buf)).toBe("abc");
  });
});
