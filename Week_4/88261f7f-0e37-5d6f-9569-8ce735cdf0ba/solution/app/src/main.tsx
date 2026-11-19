import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { User } from "../shared/api";
import { get } from "./api";
import { Board } from "./Board";
import { Desk } from "./Desk";
import { GuestPage } from "./GuestPage";
import { Guests } from "./Guests";
import { Rates } from "./Rates";
import { Reports } from "./Reports";
import { navigate, usePath } from "./router";
import { SessionProvider } from "./session";
import { NotFound, useShellLive } from "./Shell";
import { SignIn, homeOf } from "./SignIn";
import "./styles.css";

const OPEN_TO: Record<string, readonly User["role"][]> = {
  "/desk": ["owner", "front_desk"],
  "/guests": ["owner", "front_desk"],
  "/rates": ["owner"],
  "/reports": ["owner"],
  "/board": ["owner", "front_desk", "housekeeper"],
};

function Screen({ path, user }: { path: string; user: User }) {
  useShellLive();
  if (!OPEN_TO[path]?.includes(user.role)) return <NotFound />;
  switch (path) {
    case "/desk": return <Desk />;
    case "/guests": return <Guests />;
    case "/rates": return <Rates />;
    case "/reports": return <Reports />;
    default: return <Board />;
  }
}

function App() {
  const path = usePath();
  const token = /^\/checkin\/([^/]+)$/.exec(path)?.[1];
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    if (token) return;
    void get<{ user: User }>("/api/session").then((answer) => {
      const found = answer.ok ? answer.data.user : null;
      setUser(found);
      if (!found && path !== "/") navigate("/");
      else if (found && path === "/") navigate(homeOf(found));
    });
  }, [path, token]);

  if (token) return <GuestPage token={decodeURIComponent(token)} />;
  if (user === undefined) return null;
  if (user === null) return <SignIn onSignedIn={(signedIn) => { setUser(signedIn); navigate(homeOf(signedIn)); }} />;
  return (
    <SessionProvider user={user}>
      <Screen path={path} user={user} />
    </SessionProvider>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
