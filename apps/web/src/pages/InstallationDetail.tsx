import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { api, type Installation } from "../api/client";
import { Shell } from "../components/Shell";
import { StatusBadge } from "../components/StatusBadge";

function CopyChip({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard access denied — nothing to recover, the value is still selectable
    }
  }

  return (
    <div className="copy-row">
      <code className="code-chip">{value}</code>
      <button type="button" className="btn btn-sm" onClick={copy}>
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

const DEPLOY_LOCKED_STATUSES = new Set<Installation["status"]>(["cloning", "building", "starting"]);

export function InstallationDetail({ onLoggedOut }: { onLoggedOut: () => void }) {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [installation, setInstallation] = useState<Installation | null>(null);
  const [envRows, setEnvRows] = useState<[string, string][]>([]);
  const [portEnvVar, setPortEnvVar] = useState("PORT");
  const [hostEnvVar, setHostEnvVar] = useState("HOST");
  const [httpPath, setHttpPath] = useState("/mcp");
  const [log, setLog] = useState("");
  const [logLoaded, setLogLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    if (!id) return;
    const data = await api.getInstallation(id);
    setInstallation(data);
    setPortEnvVar(data.portEnvVar);
    setHostEnvVar(data.hostEnvVar);
    setHttpPath(data.httpPath);

    const detectedEnvKeys = (location.state as { detectedEnvKeys?: string[] } | null)?.detectedEnvKeys ?? [];
    const keys = new Set([...Object.keys(data.env), ...detectedEnvKeys]);
    setEnvRows([...keys].map((k) => [k, data.env[k] ?? ""]));
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function withBusy(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function loadLogs() {
    if (!installation) return;
    await withBusy("logs", async () => {
      const { log } = await api.logs(installation.id);
      setLog(log);
      setLogLoaded(true);
    });
  }

  if (!installation) {
    return (
      <Shell title="Installation" onLoggedOut={onLoggedOut}>
        <p className="cell-dim">Loading…</p>
      </Shell>
    );
  }

  const deployLocked = DEPLOY_LOCKED_STATUSES.has(installation.status);

  return (
    <Shell title={installation.name} onLoggedOut={onLoggedOut}>
      <a
        href="/"
        className="back-link"
        onClick={(e) => {
          e.preventDefault();
          navigate("/");
        }}
      >
        ← Back to installations
      </a>

      <div className="page-header">
        <div>
          <div className="detail-title-row">
            <h2 style={{ fontSize: 20 }}>{installation.name}</h2>
            <StatusBadge status={installation.status} />
          </div>
          <div className="detail-sub">{installation.slug}</div>
          {installation.statusDetail && <p className="status-detail">{installation.statusDetail}</p>}
        </div>
      </div>

      {error && <div className="alert">{error}</div>}

      {installation.status === "running" && installation.bearerToken && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">Access</span>
            <span className="card-hint">Used by MCP clients to reach this server</span>
          </div>
          <dl className="kv">
            <dt>Public URL</dt>
            <dd>
              <CopyChip value={installation.publicUrl} />
            </dd>
            <dt>Bearer token</dt>
            <dd>
              <div className="copy-row">
                <code className="code-chip">{installation.bearerToken}</code>
                <button type="button" className="btn btn-sm" onClick={() => navigator.clipboard.writeText(installation.bearerToken!)}>
                  Copy
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={busy !== null}
                  onClick={() =>
                    withBusy("regen", async () => {
                      await api.regenerateToken(installation.id);
                      await refresh();
                    })
                  }
                >
                  {busy === "regen" ? "Regenerating…" : "Regenerate"}
                </button>
              </div>
            </dd>
          </dl>
        </div>
      )}

      <div className="card section-gap">
        <div className="card-header">
          <span className="card-title">Configuration</span>
          <span className="card-hint">Environment variables and runtime wiring</span>
        </div>

        {envRows.length === 0 && <p className="env-empty">No environment variables configured.</p>}
        {envRows.map(([k, v], idx) => (
          <div className="env-row" key={idx}>
            <input
              className="input-mono"
              value={k}
              placeholder="KEY"
              onChange={(e) => {
                const next = [...envRows];
                next[idx] = [e.target.value, v];
                setEnvRows(next);
              }}
            />
            <input
              className="input-mono"
              value={v}
              placeholder="value"
              onChange={(e) => {
                const next = [...envRows];
                next[idx] = [k, e.target.value];
                setEnvRows(next);
              }}
            />
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEnvRows(envRows.filter((_, i) => i !== idx))}>
              Remove
            </button>
          </div>
        ))}
        <button type="button" className="btn btn-sm" onClick={() => setEnvRows([...envRows, ["", ""]])}>
          Add variable
        </button>

        <div className="row section-gap">
          <div className="field">
            <label htmlFor="port-env">Port env var</label>
            <input id="port-env" className="input-mono" value={portEnvVar} onChange={(e) => setPortEnvVar(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="host-env">Host env var</label>
            <input id="host-env" className="input-mono" value={hostEnvVar} onChange={(e) => setHostEnvVar(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="http-path">HTTP path</label>
            <input id="http-path" className="input-mono" value={httpPath} onChange={(e) => setHttpPath(e.target.value)} />
          </div>
        </div>

        <button
          type="button"
          className="btn btn-primary"
          disabled={busy !== null}
          onClick={() =>
            withBusy("config", async () => {
              const env = Object.fromEntries(envRows.filter(([k]) => k.trim() !== ""));
              await api.configureInstallation(installation.id, { env, portEnvVar, hostEnvVar, httpPath });
              await refresh();
            })
          }
        >
          {busy === "config" ? "Saving…" : "Save configuration"}
        </button>
      </div>

      <div className="card section-gap">
        <div className="card-header">
          <span className="card-title">Actions</span>
        </div>
        <div className="actions-row">
          <button
            type="button"
            className="btn"
            disabled={busy !== null}
            onClick={() =>
              withBusy("build", async () => {
                await api.build(installation.id);
                await refresh();
              })
            }
          >
            {busy === "build" ? "Building…" : "Build"}
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy !== null || deployLocked}
            onClick={() =>
              withBusy("deploy", async () => {
                await api.deploy(installation.id);
                await refresh();
              })
            }
          >
            {busy === "deploy" ? "Deploying…" : "Deploy"}
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy !== null}
            onClick={() =>
              withBusy("redeploy", async () => {
                await api.redeploy(installation.id, false);
                await refresh();
              })
            }
          >
            {busy === "redeploy" ? "Redeploying…" : "Redeploy (env only)"}
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy !== null}
            onClick={() =>
              withBusy("rebuild", async () => {
                await api.redeploy(installation.id, true);
                await refresh();
              })
            }
          >
            {busy === "rebuild" ? "Rebuilding…" : "Rebuild & redeploy"}
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={busy !== null}
            onClick={() => {
              if (!window.confirm(`Delete "${installation.name}"? This stops and removes its container.`)) return;
              withBusy("delete", async () => {
                await api.remove(installation.id);
                navigate("/");
              });
            }}
          >
            {busy === "delete" ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>

      <div className="card section-gap">
        <div className="card-header">
          <span className="card-title">Build log</span>
          <button type="button" className="btn btn-sm" disabled={busy !== null} onClick={loadLogs}>
            {busy === "logs" ? "Loading…" : "Refresh log"}
          </button>
        </div>
        <pre className={`log-pane${logLoaded && !log ? " log-empty" : ""}`}>{log}</pre>
      </div>
    </Shell>
  );
}
