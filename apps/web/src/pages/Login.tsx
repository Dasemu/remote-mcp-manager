import { useState } from "react";
import { api } from "../api/client";

export function Login({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.login(password);
      onLoggedIn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="card login-card">
        <div className="login-brand">
          <span className="brand-mark">mcp</span>
          <div>
            <h1 className="login-title">remote-mcp-manager</h1>
          </div>
          <p className="login-sub">Sign in to manage your MCP server installations.</p>
        </div>
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="password">Admin password</label>
            <input
              id="password"
              type="password"
              placeholder="Enter password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
          </div>
          {error && <div className="alert">{error}</div>}
          <button type="submit" className="btn btn-primary" disabled={loading} style={{ width: "100%", justifyContent: "center" }}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
