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
  const [checking, setChecking] = useState(false);

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

  const repoConfigured = info !== null && info.unavailableReason !== "SELF_UPDATE_REPO_URL is not set";
  const waitingForRemote = repoConfigured && info !== null && info.remote === null && info.phase === "idle";

  // The first remote check runs in the background on the server; poll briefly until it lands.
  useEffect(() => {
    if (!waitingForRemote) return;
    let tries = 0;
    const timer = setInterval(() => {
      if (++tries > 10) clearInterval(timer);
      else refresh();
    }, 3000);
    return () => clearInterval(timer);
  }, [waitingForRemote]);

  async function checkNow() {
    setChecking(true);
    setError(null);
    try {
      setInfo(await api.checkManager());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setChecking(false);
    }
  }

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
          {info ? `Version ${info.version} · ${info.sha ? info.sha.slice(0, 7) : "unknown commit"}` : "Restarting…"}
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
      {!updating && info && repoConfigured && <RemoteLine info={info} checking={checking || waitingForRemote} />}
      {info && !info.canSelfUpdate && info.unavailableReason && (
        <p className="status-detail">Self-update unavailable: {info.unavailableReason}.</p>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          className="btn"
          disabled={!info?.canSelfUpdate || updating}
          onClick={update}
          title="Fetch the latest source, build a new image and replace this container"
        >
          {updating ? "Updating…" : "Update manager"}
        </button>
        {repoConfigured && (
          <button type="button" className="btn btn-ghost" disabled={checking || updating} onClick={checkNow}>
            {checking ? "Checking…" : "Check for updates"}
          </button>
        )}
      </div>

      {log && <pre className="log-pane">{log}</pre>}
    </div>
  );
}

function RemoteLine({ info, checking }: { info: SystemInfo; checking: boolean }) {
  const remote = info.remote;
  if (!remote) return <p className="status-detail">{checking ? "Checking the remote…" : ""}</p>;
  if (remote.error) return <p className="status-detail">Could not check the remote: {remote.error}</p>;

  const head = remote.remoteSha?.slice(0, 7);
  const when = new Date(remote.checkedAt).toLocaleTimeString();
  if (remote.behind === 0) {
    return <p className="status-detail">Up to date with {info.ref} ({head}) · checked {when}</p>;
  }
  if (remote.behind === null) {
    return (
      <p className="status-detail">
        {info.sha
          ? `The installed commit is not in the history of ${info.ref}; its head is ${head}.`
          : `The installed commit is unknown; ${info.ref} is at ${head}.`}
      </p>
    );
  }
  return (
    <div>
      <p className="status-detail">
        {remote.behind} newer commit{remote.behind === 1 ? "" : "s"} on {info.ref} (head {head}) · checked {when}
      </p>
      <ul className="status-detail" style={{ margin: "4px 0 8px 18px" }}>
        {remote.commits.map((c) => (
          <li key={c.sha}>
            <code>{c.sha}</code> {c.subject}
          </li>
        ))}
        {remote.behind > remote.commits.length && <li>…and {remote.behind - remote.commits.length} more</li>}
      </ul>
    </div>
  );
}
