import { describe, expect, it } from "vitest";
import { isNotFoundError, isNotModifiedError } from "./errors.js";

describe("isNotFoundError", () => {
  it("matches a Docker API 404", () => {
    expect(isNotFoundError(Object.assign(new Error("no such container"), { statusCode: 404 }))).toBe(true);
  });

  it("does not match other Docker errors or non-errors", () => {
    expect(isNotFoundError(Object.assign(new Error("server error"), { statusCode: 500 }))).toBe(false);
    expect(isNotFoundError(new Error("docker inspect x timed out after 10000ms"))).toBe(false);
    expect(isNotFoundError(undefined)).toBe(false);
    expect(isNotFoundError("404")).toBe(false);
  });
});

describe("isNotModifiedError", () => {
  it("matches the 304 docker-modem raises for already started/stopped containers", () => {
    expect(isNotModifiedError(Object.assign(new Error("already started"), { statusCode: 304 }))).toBe(true);
    expect(isNotModifiedError(Object.assign(new Error("boom"), { statusCode: 500 }))).toBe(false);
    expect(isNotModifiedError(new Error("plain"))).toBe(false);
  });
});
