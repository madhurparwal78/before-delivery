import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./app.css";
import { api, redirectTo } from "./api.ts";
import type { LimitsConfig, User } from "../shared/types.ts";
import { LandingPage } from "./pages/landing.tsx";
import { SignInPage } from "./pages/signin.tsx";
import { SignUpPage } from "./pages/signup.tsx";
import { VerifyPage } from "./pages/verify.tsx";
import { InvitePage } from "./pages/invite.tsx";
import { FileBrowser } from "./pages/browser.tsx";
import { NotebookPage } from "./pages/notebook.tsx";

export function navigate(path: string): void {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function currentPath(): string {
  return window.location.pathname;
}

function useRoute(): string {
  const [path, setPath] = useState(currentPath());
  useEffect(() => {
    const onPop = () => setPath(currentPath());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return path;
}

function App() {
  const path = useRoute();
  const [user, setUser] = useState<User | null>(null);
  const [config, setConfig] = useState<LimitsConfig | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void (async () => {
      const configResult = await api.config();
      if (configResult.ok) setConfig(configResult.value);
      const me = await api.me();
      setUser(me.ok ? me.value.user : null);
      setReady(true);
    })();
  }, []);

  const refreshUser = () => {
    void api.me().then((result) => setUser(result.ok ? result.value.user : null));
  };

  if (!ready) {
    return <div className="container"><p>Loading…</p></div>;
  }

  if (path === "/" || path === "") return <LandingPage user={user} config={config} onAuthChange={refreshUser} />;
  if (path === "/signin") return <SignInPage onAuthChange={refreshUser} />;
  if (path.startsWith("/signup")) {
    const token = new URLSearchParams(window.location.search).get("invitation");
    return <SignUpPage invitationToken={token} onAuthChange={refreshUser} />;
  }
  if (path.startsWith("/verify/")) return <VerifyPage token={path.slice("/verify/".length)} />;
  if (path.startsWith("/invite/")) return <InvitePage token={path.slice("/invite/".length)} user={user} onAuthChange={refreshUser} />;
  if (path === "/notebooks" || path === "/notebooks/") {
    if (user === null) {
      redirectTo(`/signin?next=${encodeURIComponent("/notebooks")}`);
      return null;
    }
    return <FileBrowser user={user} />;
  }
  const notebookMatch = path.match(/^\/notebooks\/([^/]+)$/);
  if (notebookMatch !== null) {
    if (user === null) {
      redirectTo(`/signin?next=${encodeURIComponent(path)}`);
      return null;
    }
    return <NotebookPage notebookId={notebookMatch[1]} user={user} config={config} />;
  }
  return <LandingPage user={user} config={config} onAuthChange={refreshUser} />;
}

const root = document.getElementById("root");
if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
