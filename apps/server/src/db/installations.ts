import crypto from "node:crypto";
import { db } from "./index.js";
import { encryptSecret, decryptSecret } from "../crypto/secrets.js";

export type InstallationStatus =
  | "draft"
  | "cloning"
  | "building"
  | "built"
  | "starting"
  | "running"
  | "stopped"
  | "error";

export interface Installation {
  id: string;
  slug: string;
  name: string;
  repoUrl: string;
  gitRef: string | null;
  status: InstallationStatus;
  statusDetail: string | null;
  imageTag: string | null;
  containerId: string | null;
  containerName: string;
  internalPort: number;
  httpPath: string;
  portEnvVar: string;
  hostEnvVar: string;
  env: Record<string, string>;
  bearerToken: string | null;
  basicAuthUsername: string | null;
  basicAuthPassword: string | null;
  startCommand: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Row {
  id: string;
  slug: string;
  name: string;
  repo_url: string;
  git_ref: string | null;
  status: InstallationStatus;
  status_detail: string | null;
  image_tag: string | null;
  container_id: string | null;
  container_name: string;
  internal_port: number;
  http_path: string;
  port_env_var: string;
  host_env_var: string;
  bearer_token_encrypted: string | null;
  env_json_encrypted: string | null;
  basic_auth_username: string | null;
  basic_auth_password_encrypted: string | null;
  start_command: string | null;
  created_at: string;
  updated_at: string;
}

function rowToInstallation(row: Row): Installation {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    repoUrl: row.repo_url,
    gitRef: row.git_ref,
    status: row.status,
    statusDetail: row.status_detail,
    imageTag: row.image_tag,
    containerId: row.container_id,
    containerName: row.container_name,
    internalPort: row.internal_port,
    httpPath: row.http_path,
    portEnvVar: row.port_env_var,
    hostEnvVar: row.host_env_var,
    env: row.env_json_encrypted ? JSON.parse(decryptSecret(row.env_json_encrypted)) : {},
    bearerToken: row.bearer_token_encrypted ? decryptSecret(row.bearer_token_encrypted) : null,
    basicAuthUsername: row.basic_auth_username,
    basicAuthPassword: row.basic_auth_password_encrypted ? decryptSecret(row.basic_auth_password_encrypted) : null,
    startCommand: row.start_command,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function createInstallation(input: { name: string; slug: string; repoUrl: string; gitRef?: string }): Installation {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO installations
      (id, slug, name, repo_url, git_ref, status, container_name, created_at, updated_at)
     VALUES (@id, @slug, @name, @repoUrl, @gitRef, 'draft', @containerName, @now, @now)`,
  ).run({
    id,
    slug: input.slug,
    name: input.name,
    repoUrl: input.repoUrl,
    gitRef: input.gitRef ?? null,
    containerName: `mcp-${input.slug}`,
    now,
  });
  return getInstallationById(id)!;
}

export function getInstallationById(id: string): Installation | undefined {
  const row = db.prepare("SELECT * FROM installations WHERE id = ?").get(id) as Row | undefined;
  return row ? rowToInstallation(row) : undefined;
}

export function getInstallationBySlug(slug: string): Installation | undefined {
  const row = db.prepare("SELECT * FROM installations WHERE slug = ?").get(slug) as Row | undefined;
  return row ? rowToInstallation(row) : undefined;
}

export function listInstallations(): Installation[] {
  const rows = db.prepare("SELECT * FROM installations ORDER BY created_at DESC").all() as Row[];
  return rows.map(rowToInstallation);
}

export interface InstallationUpdate {
  status?: InstallationStatus;
  statusDetail?: string | null;
  imageTag?: string | null;
  containerId?: string | null;
  internalPort?: number;
  httpPath?: string;
  portEnvVar?: string;
  hostEnvVar?: string;
  env?: Record<string, string>;
  bearerToken?: string | null;
  basicAuthUsername?: string | null;
  basicAuthPassword?: string | null;
  startCommand?: string | null;
  gitRef?: string | null;
}

export function updateInstallation(id: string, patch: InstallationUpdate): Installation {
  const current = getInstallationById(id);
  if (!current) throw new Error(`installation ${id} not found`);

  const next = {
    status: patch.status ?? current.status,
    statusDetail: patch.statusDetail !== undefined ? patch.statusDetail : current.statusDetail,
    imageTag: patch.imageTag !== undefined ? patch.imageTag : current.imageTag,
    containerId: patch.containerId !== undefined ? patch.containerId : current.containerId,
    internalPort: patch.internalPort ?? current.internalPort,
    httpPath: patch.httpPath ?? current.httpPath,
    portEnvVar: patch.portEnvVar ?? current.portEnvVar,
    hostEnvVar: patch.hostEnvVar ?? current.hostEnvVar,
    env: patch.env ?? current.env,
    bearerToken: patch.bearerToken !== undefined ? patch.bearerToken : current.bearerToken,
    basicAuthUsername:
      patch.basicAuthUsername !== undefined ? patch.basicAuthUsername : current.basicAuthUsername,
    basicAuthPassword:
      patch.basicAuthPassword !== undefined ? patch.basicAuthPassword : current.basicAuthPassword,
    startCommand: patch.startCommand !== undefined ? patch.startCommand : current.startCommand,
    gitRef: patch.gitRef !== undefined ? patch.gitRef : current.gitRef,
  };

  db.prepare(
    `UPDATE installations SET
      status = @status,
      status_detail = @statusDetail,
      image_tag = @imageTag,
      container_id = @containerId,
      internal_port = @internalPort,
      http_path = @httpPath,
      port_env_var = @portEnvVar,
      host_env_var = @hostEnvVar,
      env_json_encrypted = @envJsonEncrypted,
      bearer_token_encrypted = @bearerTokenEncrypted,
      basic_auth_username = @basicAuthUsername,
      basic_auth_password_encrypted = @basicAuthPasswordEncrypted,
      start_command = @startCommand,
      git_ref = @gitRef,
      updated_at = @updatedAt
     WHERE id = @id`,
  ).run({
    id,
    status: next.status,
    statusDetail: next.statusDetail,
    imageTag: next.imageTag,
    containerId: next.containerId,
    internalPort: next.internalPort,
    httpPath: next.httpPath,
    portEnvVar: next.portEnvVar,
    hostEnvVar: next.hostEnvVar,
    envJsonEncrypted: encryptSecret(JSON.stringify(next.env)),
    bearerTokenEncrypted: next.bearerToken ? encryptSecret(next.bearerToken) : null,
    basicAuthUsername: next.basicAuthUsername,
    basicAuthPasswordEncrypted: next.basicAuthPassword ? encryptSecret(next.basicAuthPassword) : null,
    startCommand: next.startCommand,
    gitRef: next.gitRef,
    updatedAt: new Date().toISOString(),
  });

  return getInstallationById(id)!;
}

export function deleteInstallation(id: string): void {
  db.prepare("DELETE FROM installations WHERE id = ?").run(id);
}
