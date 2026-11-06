import { useEffect, useState } from "react";
import type { User } from "../shared/types";
import { api } from "./lib/api";
import { SignInPage } from "./screens/sign-in";
import { VerifyPage } from "./screens/verify";
import { ProjectsPage } from "./screens/projects";
import { Workspace } from "./workspace/workspace";
import { AccountMenu } from "./components/account-menu";

export function App(): React.ReactElement {
  const [user, setUser] = useState<User | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [erased, setErased] = useState(false);
  const [path, setPath] = useState(window.location.pathname);
  const [routeRevision, setRouteRevision] = useState(0);

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const { data } = await api<{ user: User }>("GET", "/api/me");
        if (alive) setUser(data?.user ?? null);
      } catch {
        if (alive) setUser(null);
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [routeRevision]);

  const navigate = (to: string) => {
    window.history.pushState({}, "", to);
    setPath(to);
    setRouteRevision((r) => r + 1);
  };

  const signOut = async () => {
    await api("POST", "/api/auth/sign-out");
    setUser(null);
    setErased(false);
    navigate("/sign-in");
  };

  const markErased = () => {
    setUser(null);
    setErased(true);
    navigate("/sign-in");
  };

  if (!loaded) return <div className="boot" />;

  if (path.startsWith("/auth/verify")) {
    return <VerifyPage onSignedIn={(u, landing) => { setUser(u); navigate(landing); }} />;
  }

  if (path.startsWith("/review/")) {
    return <div className="review-shell" />;
  }

  if (!user) {
    return <SignInPage erased={erased} />;
  }

  const projectMatch = path.match(/^\/projects\/([^/]+)$/);

  return (
    <div className="app">
      {projectMatch ? (
        <Workspace
          key={projectMatch[1]}
          projectId={projectMatch[1] as string}
          user={user}
          navigate={navigate}
          accountSlot={
            <AccountMenu user={user} onSignOut={signOut} onErased={markErased} showErase={user.kind === "learner"} />
          }
        />
      ) : (
        <ProjectsPage user={user} navigate={navigate} accountSlot={
          <AccountMenu user={user} onSignOut={signOut} onErased={markErased} showErase={user.kind === "learner"} />
        } />
      )}
    </div>
  );
}
