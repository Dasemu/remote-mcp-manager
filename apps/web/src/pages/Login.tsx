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
    <div style={{ maxWidth: 320, margin: "10vh auto" }}>
      <h1>remote-mcp-manager</h1>
      <form onSubmit={submit}>
        <input
          type="password"
          placeholder="Admin password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          style={{ width: "100%", padding: 8, marginBottom: 8 }}
        />
        <button type="submit" disabled={loading} style={{ width: "100%", padding: 8 }}>
          {loading ? "Signing in…" : "Sign in"}
        </button>
        {error && <p style={{ color: "crimson" }}>{error}</p>}
      </form>
    </div>
  );
}
