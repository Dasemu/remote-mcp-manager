import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import type { SessionData } from "express-session";
import { SqliteSessionStore } from "./sqliteStore.js";

function makeStore() {
  return new SqliteSessionStore(new Database(":memory:"), 60_000);
}

function sessionExpiringIn(ms: number): SessionData {
  return { cookie: { expires: new Date(Date.now() + ms), originalMaxAge: ms }, authenticated: true } as SessionData;
}

const get = (store: SqliteSessionStore, sid: string) =>
  new Promise<SessionData | null | undefined>((resolve, reject) =>
    store.get(sid, (err, sess) => (err ? reject(err) : resolve(sess))),
  );

describe("SqliteSessionStore", () => {
  it("round-trips a session and destroys it", async () => {
    const store = makeStore();
    store.set("a", sessionExpiringIn(60_000));
    expect((await get(store, "a"))?.authenticated).toBe(true);

    await new Promise<void>((resolve) => store.destroy("a", () => resolve()));
    expect(await get(store, "a")).toBeNull();
  });

  it("treats an expired session as missing", async () => {
    const store = makeStore();
    store.set("old", sessionExpiringIn(-1_000));
    expect(await get(store, "old")).toBeNull();
  });

  it("purges expired sessions that are never read again", () => {
    const db = new Database(":memory:");
    const store = new SqliteSessionStore(db, 60_000);
    store.set("old", sessionExpiringIn(-1_000));
    store.set("live", sessionExpiringIn(60_000));
    store.purgeExpired();
    expect(db.prepare("SELECT sid FROM sessions").all()).toEqual([{ sid: "live" }]);
  });
});
