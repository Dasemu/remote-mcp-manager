import { useEffect, useState } from "react";
import { api, type SystemInfo } from "../api/client";

// Stops waiting for a manager that never comes back (the updater itself gives up well before this).
const MAX_WAIT_MS = 10 * 60 * 1000;

const PHASE_LABEL: Record<SystemInfo["phase"], string> = {
  idle: "",
  cloning: "Fetching the latest source…",
  building: "Building the new image…",
  "handing-over": "Handing over to the new version…",
};

export function ManagerCard() {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requested, setRequested] = useState(false);
  const [unreachable, setUnreachable] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [gaveUp, setGaveUp] = useState(false);

  async function refresh() {
    try {
      setInfo(await api.systemInfo());
      setUnreachable(false);
    } catch {
      // Expected while the container is being swapped; keep polling until it answers again.
      setUnreachable(true);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const updating = !gaveUp && (requested || (info !== null && info.phase !== "idle"));

  useEffect(() => {
    if (!updating) return;
    const timer = setInterval(() => {
      if (startedAt !== null && Date.now() - startedAt > MAX_WAIT_MS) {
        setGaveUp(true);
        setRequested(false);
        return;
      }
      refresh();
    }, 3000);
    return () => clearInterval(timer);
  }, [updating, startedAt]);

  // The update is over once the manager answers again with nothing in progress.
  useEffect(() => {
    // A restarted manager has a smaller uptime than the time since we asked.
    const restarted = startedAt !== null && info !== null && info.uptimeSec * 1000 < Date.now() - startedAt;
    if (requested && info && info.phase === "idle" && !unreachable && (info.lastUpdate || info.error || restarted)) {
      setRequested(false);
    }
  }, [requested, info, unreachable, startedAt]);

  async function update() {
    if (!info) return;
    const msg =
      `Update the manager from ${info.ref}? It builds a new image, then restarts itself ` +
      "(a few seconds of downtime; MCP clients should reconnect). It rolls back if the new version isn't healthy.";
    if (!window.confirm(msg)) return;
    setError(null);
    try {
      await api.updateManager();
      setGaveUp(false);
      setStartedAt(Date.now());
      setRequested(true);
      refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!info && !unreachable) return null;

  const log = info?.log || info?.lastUpdate?.log || "";

  return (
    <div className="card section-gap">
      <div className="card-header">
        <span className="card-title">Manager</span>
        <span className="card-hint">
          {info ? `Version ${info.version} · ${info.ref}` : "Restarting…"}
        </span>
      </div>

      {updating && (
        <p className="status-detail">
          {unreachable ? "The manager is restarting, waiting for it to come back…" : PHASE_LABEL[info?.phase ?? "idle"]}
        </p>
      )}
      {error && <div className="alert">{error}</div>}
      {gaveUp && <div className="alert">The manager did not come back in 10 minutes; check the host.</div>}
      {info?.error && <div className="alert">Update failed: {info.error}</div>}
      {!updating && info?.lastUpdate && (
        <p className="status-detail">
          Last update {info.lastUpdate.ok ? "succeeded" : "did not complete (rolled back or failed; see the log)"} ({new Date(info.lastUpdate.finishedAt).toLocaleString()}).
        </p>
      )}
      {info && !info.canSelfUpdate && info.unavailableReason && (
        <p className="status-detail">Self-update unavailable: {info.unavailableReason}.</p>
      )}

      <div>
        <button
          type="button"
          className="btn"
          disabled={!info?.canSelfUpdate || updating}
          onClick={update}
          title="Fetch the latest source, build a new image and replace this container"
        >
          {updating ? "Updating…" : "Update manager"}
        </button>
      </div>

      {log && <pre className="log-pane">{log}</pre>}
    </div>
  );
}
