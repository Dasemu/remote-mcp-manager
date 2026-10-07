import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { api, type Installation } from "../api/client";

export function InstallationDetail() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [installation, setInstallation] = useState<Installation | null>(null);
  const [envRows, setEnvRows] = useState<[string, string][]>([]);
  const [portEnvVar, setPortEnvVar] = useState("PORT");
  const [hostEnvVar, setHostEnvVar] = useState("HOST");
  const [httpPath, setHttpPath] = useState("/mcp");
  const [log, setLog] = useState("");
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

  if (!installation) return <p>Loading…</p>;

  return (
    <div>
      <button onClick={() => navigate("/")}>← Back</button>
      <h1>{installation.name}</h1>
      <p>
        Status: <strong>{installation.status}</strong>
        {installation.statusDetail && <span style={{ color: "crimson" }}> — {installation.statusDetail}</span>}
      </p>

      {installation.status === "running" && installation.bearerToken && (
        <div style={{ border: "1px solid #ccc", padding: 12, marginBottom: 16 }}>
          <strong>Public URL:</strong> <code>{installation.publicUrl}</code>
          <br />
          <strong>Bearer token:</strong> <code>{installation.bearerToken}</code>{" "}
          <button
            onClick={() =>
              withBusy("regen", async () => {
                await api.regenerateToken(installation.id);
                await refresh();
              })
            }
          >
            Regenerate token
          </button>
        </div>
      )}

      <h2>Configuration</h2>
      <table>
        <tbody>
          {envRows.map(([k, v], idx) => (
            <tr key={idx}>
              <td>
                <input
                  value={k}
                  onChange={(e) => {
                    const next = [...envRows];
                    next[idx] = [e.target.value, v];
                    setEnvRows(next);
                  }}
                />
              </td>
              <td>
                <input
                  value={v}
                  onChange={(e) => {
                    const next = [...envRows];
                    next[idx] = [k, e.target.value];
                    setEnvRows(next);
                  }}
                />
              </td>
              <td>
                <button onClick={() => setEnvRows(envRows.filter((_, i) => i !== idx))}>remove</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={() => setEnvRows([...envRows, ["", ""]])}>Add env var</button>

      <div style={{ marginTop: 12 }}>
        <label>
          Port env var name <input value={portEnvVar} onChange={(e) => setPortEnvVar(e.target.value)} />
        </label>
        <label style={{ marginLeft: 12 }}>
          Host env var name <input value={hostEnvVar} onChange={(e) => setHostEnvVar(e.target.value)} />
        </label>
        <label style={{ marginLeft: 12 }}>
          HTTP path <input value={httpPath} onChange={(e) => setHttpPath(e.target.value)} />
        </label>
      </div>

      <div style={{ marginTop: 12 }}>
        <button
          disabled={busy !== null}
          onClick={() =>
            withBusy("config", async () => {
              const env = Object.fromEntries(envRows.filter(([k]) => k.trim() !== ""));
              await api.configureInstallation(installation.id, { env, portEnvVar, hostEnvVar, httpPath });
              await refresh();
            })
          }
        >
          Save configuration
        </button>
      </div>

      <h2>Actions</h2>
      <button
        disabled={busy !== null}
        onClick={() =>
          withBusy("build", async () => {
            await api.build(installation.id);
            await refresh();
          })
        }
      >
        {busy === "build" ? "Building…" : "Build"}
      </button>{" "}
      <button
        disabled={busy !== null || installation.status === "cloning" || installation.status === "building" || installation.status === "starting"}
        onClick={() =>
          withBusy("deploy", async () => {
            await api.deploy(installation.id);
            await refresh();
          })
        }
      >
        {busy === "deploy" ? "Deploying…" : "Deploy"}
      </button>{" "}
      <button
        disabled={busy !== null}
        onClick={() =>
          withBusy("redeploy", async () => {
            await api.redeploy(installation.id, false);
            await refresh();
          })
        }
      >
        Redeploy (env only)
      </button>{" "}
      <button
        disabled={busy !== null}
        onClick={() =>
          withBusy("rebuild", async () => {
            await api.redeploy(installation.id, true);
            await refresh();
          })
        }
      >
        Rebuild & redeploy
      </button>{" "}
      <button
        disabled={busy !== null}
        onClick={() =>
          withBusy("delete", async () => {
            await api.remove(installation.id);
            navigate("/");
          })
        }
      >
        Delete
      </button>

      {error && <p style={{ color: "crimson" }}>{error}</p>}

      <h2>Build log</h2>
      <button
        onClick={() =>
          withBusy("logs", async () => {
            const { log } = await api.logs(installation.id);
            setLog(log);
          })
        }
      >
        Refresh log
      </button>
      <pre style={{ background: "#111", color: "#0f0", padding: 12, maxHeight: 300, overflow: "auto" }}>{log}</pre>
    </div>
  );
}
