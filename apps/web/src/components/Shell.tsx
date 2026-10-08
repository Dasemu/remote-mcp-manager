import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { api } from "../api/client";

export function Shell({
  title,
  actions,
  children,
  onLoggedOut,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  onLoggedOut: () => void;
}) {
  async function logout() {
    await api.logout();
    onLoggedOut();
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">mcp</span>
          <div>
            <div className="brand-name">remote-mcp-manager</div>
            <div className="brand-sub">Server control room</div>
          </div>
        </div>
        <nav className="nav">
          <NavLink to="/" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`} end>
            Installations
          </NavLink>
        </nav>
        <div className="sidebar-footer">
          <button type="button" className="btn btn-ghost btn-sm" onClick={logout}>
            Sign out
          </button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <h1>{title}</h1>
          {actions && <div className="topbar-actions">{actions}</div>}
        </header>
        <div className="content">{children}</div>
      </div>
    </div>
  );
}
