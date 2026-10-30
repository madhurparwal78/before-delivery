import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { TopBar } from "./components/TopBar";
import { allowed, landingFor, navigate } from "./navigation";
import { Billing } from "./screens/Billing";
import { Board } from "./screens/Board";
import { MySeats } from "./screens/MySeats";
import { Offers } from "./screens/Offers";
import { Org } from "./screens/Org";
import { Requests } from "./screens/Requests";
import { SignIn } from "./screens/SignIn";
import type { User } from "./types";

function usePath(): string {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return path;
}

const SCREENS: Record<string, (user: User) => React.ReactNode> = {
  "/requests": (user) => <Requests user={user} />,
  "/board": () => <Board />,
  "/offers": (user) => <Offers user={user} />,
  "/my-seats": (user) => <MySeats user={user} />,
  "/billing": () => <Billing />,
  "/org": () => <Org />,
};

export function App() {
  const path = usePath();
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    api<{ user: User }>("GET", "/api/me")
      .then((result) => setUser(result.ok ? result.data.user : null))
      .catch(() => setUser(null));
  }, []);

  useEffect(() => {
    if (user && !allowed(user.role, path)) navigate(landingFor(user.role), true);
  }, [user, path]);

  const signedIn = useCallback((next: User) => {
    setUser(next);
    navigate(landingFor(next.role));
  }, []);

  const signedOut = useCallback(() => {
    setUser(null);
    navigate("/");
  }, []);

  if (user === undefined) return <div className="app-loading" aria-busy="true" />;
  if (user === null) return <SignIn onSignedIn={signedIn} />;
  return (
    <div className="app">
      <TopBar user={user} path={path} onSignedOut={signedOut} />
      <main className="main" id="main">
        {allowed(user.role, path) ? SCREENS[path]?.(user) : null}
      </main>
    </div>
  );
}
