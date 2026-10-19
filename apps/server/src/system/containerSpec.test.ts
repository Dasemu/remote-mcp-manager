import { describe, expect, it } from "vitest";
import type { ContainerInspectInfo } from "dockerode";
import { buildReplacementSpec } from "./containerSpec.js";

const old = {
  Id: "0123456789abcdef0123",
  Name: "/remote-mcp-manager-manager-1",
  Config: {
    Env: ["PATH=/usr/bin", "NODE_OPTIONS=--old", "ADMIN_PASSWORD=x", "PORT=3000"],
    Labels: { "com.docker.compose.service": "manager" },
    ExposedPorts: { "3000/tcp": {} },
    User: "",
    Hostname: "0123456789ab",
    Cmd: ["node", "old.js"],
  },
  HostConfig: {
    NetworkMode: "mcp-net",
    Binds: ["/var/run/docker.sock:/var/run/docker.sock", "./data:/repo/data"],
    RestartPolicy: { Name: "unless-stopped" },
  },
  NetworkSettings: { Networks: { "mcp-net": { Aliases: ["manager", "0123456789ab"] } } },
} as unknown as ContainerInspectInfo;

describe("buildReplacementSpec", () => {
  const spec = buildReplacementSpec(old, ["PATH=/usr/bin", "NODE_OPTIONS=--old"], "mcpmgr-manager:new");

  it("keeps the name, host config and operator-set env, and runs the new image", () => {
    expect(spec.name).toBe("remote-mcp-manager-manager-1");
    expect(spec.Image).toBe("mcpmgr-manager:new");
    expect(spec.HostConfig).toBe(old.HostConfig);
    expect(spec.Env).toEqual(["ADMIN_PASSWORD=x", "PORT=3000"]);
  });

  it("does not pin the old image's Cmd or hostname", () => {
    expect(spec.Cmd).toBeUndefined();
    expect(spec.Hostname).toBeUndefined();
  });

  it("keeps network aliases except the old container's own id", () => {
    expect(spec.NetworkingConfig?.EndpointsConfig?.["mcp-net"]?.Aliases).toEqual(["manager"]);
  });
});
