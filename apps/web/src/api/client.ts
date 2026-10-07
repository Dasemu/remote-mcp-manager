export interface Installation {
  id: string;
  slug: string;
  name: string;
  repoUrl: string;
  gitRef: string | null;
  status: "draft" | "cloning" | "building" | "built" | "starting" | "running" | "stopped" | "error";
  statusDetail: string | null;
  imageTag: string | null;
  containerName: string;
  internalPort: number;
  httpPath: string;
  portEnvVar: string;
  hostEnvVar: string;
  env: Record<string, string>;
  bearerToken: string | null;
  publicUrl: string;
  createdAt: string;
  updatedAt: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `request failed with ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  session: () => request<{ authenticated: boolean }>("/api/auth/session"),
  login: (password: string) => request<{ ok: true }>("/api/auth/login", { method: "POST", body: JSON.stringify({ password }) }),
  logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST" }),

  listInstallations: () => request<Installation[]>("/api/installations"),
  getInstallation: (id: string) => request<Installation>(`/api/installations/${id}`),
  createInstallation: (input: { name: string; repoUrl: string; gitRef?: string }) =>
    request<{ installation: Installation; detectedEnvKeys: string[] }>("/api/installations", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  configureInstallation: (
    id: string,
    patch: { env?: Record<string, string>; portEnvVar?: string; hostEnvVar?: string; httpPath?: string },
  ) => request<Installation>(`/api/installations/${id}/config`, { method: "PATCH", body: JSON.stringify(patch) }),
  build: (id: string) => request<Installation>(`/api/installations/${id}/build`, { method: "POST" }),
  deploy: (id: string) => request<Installation>(`/api/installations/${id}/deploy`, { method: "POST" }),
  redeploy: (id: string, rebuild: boolean) =>
    request<Installation>(`/api/installations/${id}/redeploy`, { method: "POST", body: JSON.stringify({ rebuild }) }),
  regenerateToken: (id: string) =>
    request<{ bearerToken: string }>(`/api/installations/${id}/regenerate-token`, { method: "POST" }),
  remove: (id: string) => request<void>(`/api/installations/${id}`, { method: "DELETE" }),
  logs: (id: string) => request<{ log: string }>(`/api/installations/${id}/logs`),
};
