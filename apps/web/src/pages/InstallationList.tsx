import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Installation } from "../api/client";
import { InstallWizard } from "./InstallWizard";
import { Shell } from "../components/Shell";
import { StatusBadge } from "../components/StatusBadge";

export function InstallationList({ onLoggedOut }: { onLoggedOut: () => void }) {
  const [installations, setInstallations] = useState<Installation[] | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const navigate = useNavigate();

  async function refresh() {
    setInstallations(await api.listInstallations());
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <Shell
      title="Installations"
      onLoggedOut={onLoggedOut}
      actions={
        <button type="button" className="btn btn-primary" onClick={() => setShowWizard(true)}>
          New installation
        </button>
      }
    >
      {showWizard && (
        <InstallWizard
          onCancel={() => setShowWizard(false)}
          onCreated={(id, detectedEnvKeys) => {
            setShowWizard(false);
            navigate(`/installations/${id}`, { state: { detectedEnvKeys } });
          }}
        />
      )}

      {installations && installations.length === 0 && (
        <div className="empty-state card">
          <h2 style={{ fontSize: 15 }}>No installations yet</h2>
          <p>Add a GitHub repository to clone, build, and deploy it as an MCP server.</p>
        </div>
      )}

      {installations && installations.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Slug</th>
                <th>Repository</th>
              </tr>
            </thead>
            <tbody>
              {installations.map((i) => (
                <tr key={i.id} className="row-link" onClick={() => navigate(`/installations/${i.id}`)}>
                  <td className="cell-name">{i.name}</td>
                  <td>
                    <StatusBadge status={i.status} />
                  </td>
                  <td className="cell-mono">{i.slug}</td>
                  <td className="cell-dim">{i.repoUrl}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}
