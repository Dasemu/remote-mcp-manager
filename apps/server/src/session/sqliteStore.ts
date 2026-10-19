import session from "express-session";
import type { Database } from "better-sqlite3";

const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * Session store backed by the manager's own SQLite DB. Replaces express-session's MemoryStore,
 * which never evicts sessions that aren't read again (it warns it "will leak memory" in
 * production) and loses every login on restart.
 */
export class SqliteSessionStore extends session.Store {
  constructor(private readonly db: Database, purgeIntervalMs = 10 * 60 * 1000) {
    super();
    db.exec(
      "CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, sess TEXT NOT NULL, expires INTEGER NOT NULL)",
    );
    db.exec("CREATE INDEX IF NOT EXISTS sessions_expires ON sessions (expires)");
    const timer = setInterval(() => this.purgeExpired(), purgeIntervalMs);
    timer.unref();
  }

  purgeExpired(): void {
    this.db.prepare("DELETE FROM sessions WHERE expires <= ?").run(Date.now());
  }

  private expiryOf(sess: session.SessionData): number {
    const expires = sess.cookie?.expires;
    return expires ? new Date(expires).getTime() : Date.now() + DEFAULT_TTL_MS;
  }

  get(sid: string, cb: (err?: unknown, sess?: session.SessionData | null) => void): void {
    try {
      const row = this.db.prepare("SELECT sess, expires FROM sessions WHERE sid = ?").get(sid) as
        | { sess: string; expires: number }
        | undefined;
      if (!row || row.expires <= Date.now()) {
        if (row) this.db.prepare("DELETE FROM sessions WHERE sid = ?").run(sid);
        cb(null, null);
        return;
      }
      cb(null, JSON.parse(row.sess) as session.SessionData);
    } catch (err) {
      cb(err);
    }
  }

  set(sid: string, sess: session.SessionData, cb?: (err?: unknown) => void): void {
    try {
      this.db
        .prepare(
          "INSERT INTO sessions (sid, sess, expires) VALUES (?, ?, ?) " +
            "ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires = excluded.expires",
        )
        .run(sid, JSON.stringify(sess), this.expiryOf(sess));
      cb?.();
    } catch (err) {
      cb?.(err);
    }
  }

  touch(sid: string, sess: session.SessionData, cb?: () => void): void {
    try {
      this.db.prepare("UPDATE sessions SET expires = ? WHERE sid = ?").run(this.expiryOf(sess), sid);
    } finally {
      cb?.();
    }
  }

  destroy(sid: string, cb?: (err?: unknown) => void): void {
    try {
      this.db.prepare("DELETE FROM sessions WHERE sid = ?").run(sid);
      cb?.();
    } catch (err) {
      cb?.(err);
    }
  }
}
