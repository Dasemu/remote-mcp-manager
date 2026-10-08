import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "../config/env.js";

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS installations (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  repo_url TEXT NOT NULL,
  git_ref TEXT,
  status TEXT NOT NULL,
  status_detail TEXT,
  image_tag TEXT,
  container_id TEXT,
  container_name TEXT NOT NULL,
  internal_port INTEGER NOT NULL DEFAULT 8080,
  http_path TEXT NOT NULL DEFAULT '/mcp',
  port_env_var TEXT NOT NULL DEFAULT 'PORT',
  host_env_var TEXT NOT NULL DEFAULT 'HOST',
  bearer_token_encrypted TEXT,
  env_json_encrypted TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`);

// Added after the initial release — ALTER TABLE has no "ADD COLUMN IF NOT EXISTS" in SQLite,
// so just ignore the "duplicate column" error on a DB that already has it.
for (const ddl of [
  "ALTER TABLE installations ADD COLUMN basic_auth_username TEXT",
  "ALTER TABLE installations ADD COLUMN basic_auth_password_encrypted TEXT",
  "ALTER TABLE installations ADD COLUMN start_command TEXT",
]) {
  try {
    db.exec(ddl);
  } catch (err) {
    if (!(err as Error).message.includes("duplicate column")) throw err;
  }
}
