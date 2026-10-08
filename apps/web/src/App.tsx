import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { api } from "./api/client";
import { Login } from "./pages/Login";
import { InstallationList } from "./pages/InstallationList";
import { InstallationDetail } from "./pages/InstallationDetail";

export function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    api.session().then((s) => setAuthenticated(s.authenticated));
  }, []);

  if (authenticated === null) return null;
  if (!authenticated) return <Login onLoggedIn={() => setAuthenticated(true)} />;

  const onLoggedOut = () => setAuthenticated(false);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<InstallationList onLoggedOut={onLoggedOut} />} />
        <Route path="/installations/:id" element={<InstallationDetail onLoggedOut={onLoggedOut} />} />
      </Routes>
    </BrowserRouter>
  );
}
