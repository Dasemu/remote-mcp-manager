export interface Installation {
  slug: string;
  imageTag: string;
  containerName: string;
  internalPort: number;
  httpPath: string;
  portEnvVar: string;
  hostEnvVar: string;
  env: Record<string, string>;
  bearerToken: string;
}

// Slice 2: hardcoded registry, replaced by SQLite-backed storage in slice 3.
export const installations: Installation[] = [
  {
    slug: "social",
    imageTag: "localhost/mcpmgr-test-social:latest",
    containerName: "mcp-social",
    internalPort: 8080,
    httpPath: "/mcp",
    portEnvVar: "PORT",
    hostEnvVar: "HOST",
    env: {},
    bearerToken: "dev-slice2-token",
  },
];

export function findInstallationBySlug(slug: string): Installation | undefined {
  return installations.find((i) => i.slug === slug);
}
