import { describe, expect, it, beforeAll } from "vitest";
import { encryptSecret, decryptSecret, generateBearerToken } from "./secrets.js";

beforeAll(() => {
  process.env.MASTER_KEY = "test-master-key-at-least-32-characters-long";
});

describe("secrets", () => {
  it("round-trips an encrypted value", () => {
    const encrypted = encryptSecret("hello world");
    expect(encrypted).not.toContain("hello world");
    expect(decryptSecret(encrypted)).toBe("hello world");
  });

  it("fails to decrypt with a tampered ciphertext", () => {
    const encrypted = encryptSecret("hello world");
    const tampered = Buffer.from(encrypted, "base64");
    tampered[tampered.length - 1] ^= 0xff;
    expect(() => decryptSecret(tampered.toString("base64"))).toThrow();
  });

  it("generates distinct bearer tokens", () => {
    expect(generateBearerToken()).not.toBe(generateBearerToken());
  });
});
