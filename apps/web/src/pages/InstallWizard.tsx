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
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="wizard-title">
        <div className="modal-header">
          <h2 id="wizard-title" style={{ fontSize: 15 }}>
            New installation
          </h2>
        </div>
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="w-name">Name</label>
            <input id="w-name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </div>
          <div className="field">
            <label htmlFor="w-repo">Repository URL</label>
            <input
              id="w-repo"
              className="input-mono"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="https://github.com/user/repo.git"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="w-ref">Git ref (optional)</label>
            <input id="w-ref" className="input-mono" value={gitRef} onChange={(e) => setGitRef(e.target.value)} placeholder="main" />
            <span className="field-hint">Branch, tag, or commit. Defaults to the repository's default branch.</span>
          </div>
          {error && <div className="alert">{error}</div>}
          <div className="actions-row">
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? "Cloning…" : "Clone & continue"}
            </button>
            <button type="button" className="btn" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
