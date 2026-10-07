import { useState } from "react";
import { api } from "../api/client";

export function InstallWizard({
  onCreated,
  onCancel,
}: {
  onCreated: (id: string, detectedEnvKeys: string[]) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [gitRef, setGitRef] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { installation, detectedEnvKeys } = await api.createInstallation({ name, repoUrl, gitRef: gitRef || undefined });
      onCreated(installation.id, detectedEnvKeys);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ border: "1px solid #ccc", padding: 16, marginBottom: 16 }}>
      <h2>New installation</h2>
      <form onSubmit={submit}>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required style={{ display: "block", width: "100%" }} />
        </label>
        <label>
          Repo URL
          <input
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder="https://github.com/user/repo.git"
            required
            style={{ display: "block", width: "100%" }}
          />
        </label>
        <label>
          Git ref (optional)
          <input value={gitRef} onChange={(e) => setGitRef(e.target.value)} style={{ display: "block", width: "100%" }} />
        </label>
        <div style={{ marginTop: 8 }}>
          <button type="submit" disabled={loading}>
            {loading ? "Cloning…" : "Clone & continue"}
          </button>{" "}
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
        {error && <p style={{ color: "crimson" }}>{error}</p>}
      </form>
    </div>
  );
}
