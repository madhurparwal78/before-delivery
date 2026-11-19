import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AppConfig, Person } from "../shared/types";
import { call } from "./api";
import { SignIn, SignUp } from "./pages/auth";
import { Home } from "./pages/home";
import { Landing } from "./pages/landing";
import { ProjectPage } from "./pages/project";
import { navigate, useLocation } from "./router";
import "./styles.css";

type Boot = { config: AppConfig; me: Person | null };

function App() {
  const { path, params } = useLocation();
  const [boot, setBoot] = useState<Boot | null>(null);

  useEffect(() => {
    void (async () => {
      const config = (await call<AppConfig>("GET", "/api/config")).body;
      const me = await call<{ user: Person }>("GET", "/api/me").then(
        (result) => result.body.user,
        () => null,
      );
      setBoot({ config, me });
    })();
  }, []);

  if (!boot) return null;
  const { me, config } = boot;
  const signedIn = (person: Person | null) => setBoot({ config, me: person });
  const project = /^\/projects\/([^/]+)$/.exec(path);

  if (path === "/") return me ? <Home me={me} onSignedOut={() => signedIn(null)} /> : <Landing config={config} />;
  if (path === "/signin") return <SignIn next={params.get("next")} onSignedIn={signedIn} />;
  if (path === "/signup") return <SignUp onSignedIn={signedIn} />;
  if (!me) {
    navigate(`/signin?next=${encodeURIComponent(path + location.search)}`, true);
    return null;
  }
  if (project) return <ProjectPage key={project[1]} projectId={project[1]} me={me} config={config} />;
  return (
    <main className="auth">
      <h1>No such page.</h1>
    </main>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(<App />);
