import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, type Installation } from "../api/client";
import { InstallWizard } from "./InstallWizard";

export function InstallationList() {
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [showWizard, setShowWizard] = useState(false);
  const navigate = useNavigate();

  async function refresh() {
    setInstallations(await api.listInstallations());
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Installations</h1>
        <button onClick={() => setShowWizard((v) => !v)}>{showWizard ? "Close" : "New installation"}</button>
      </div>

      {showWizard && (
        <InstallWizard
          onCancel={() => setShowWizard(false)}
          onCreated={(id, detectedEnvKeys) => {
            setShowWizard(false);
            navigate(`/installations/${id}`, { state: { detectedEnvKeys } });
          }}
        />
      )}

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th align="left">Name</th>
            <th align="left">Slug</th>
            <th align="left">Status</th>
            <th align="left">Repo</th>
          </tr>
        </thead>
        <tbody>
          {installations.map((i) => (
            <tr key={i.id} style={{ borderTop: "1px solid #eee" }}>
              <td>
                <Link to={`/installations/${i.id}`}>{i.name}</Link>
              </td>
              <td>{i.slug}</td>
              <td>{i.status}</td>
              <td>{i.repoUrl}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {installations.length === 0 && !showWizard && <p>No installations yet.</p>}
    </div>
  );
}
