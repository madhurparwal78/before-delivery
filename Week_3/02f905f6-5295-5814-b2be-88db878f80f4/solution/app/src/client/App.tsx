// The app shell: who is signed in, the header strip, and which screen the path and role allow.
import { useEffect, useState, type ReactNode } from "react";
import type { Role, User } from "../shared/api";
import { request } from "./api";
import { Header } from "./components/Header";
import { Board } from "./pages/Board";
import { Counter } from "./pages/Counter";
import { Intake } from "./pages/Intake";
import { PieceDetail } from "./pages/PieceDetail";
import { Pickup } from "./pages/Pickup";
import { Pieces } from "./pages/Pieces";
import { Rates } from "./pages/Rates";
import { SignIn } from "./pages/SignIn";
import { Studio } from "./pages/Studio";
import { Track } from "./pages/Track";
import { Link, navigate, useLocation } from "./router";

const START: Record<Role, string> = { member: "/intake", tech: "/board", owner: "/studio" };

interface Screen {
  match: RegExp;
  roles: Role[];
  render: (user: User, path: string) => ReactNode;
}

const SCREENS: Screen[] = [
  { match: /^\/intake$/, roles: ["member"], render: (user) => <Intake user={user} /> },
  { match: /^\/pieces$/, roles: ["member"], render: () => <Pieces /> },
  { match: /^\/pieces\/\d+$/, roles: ["member", "tech", "owner"], render: (user, path) => <PieceDetail user={user} number={path.split("/")[2]} /> },
  { match: /^\/board$/, roles: ["tech", "owner"], render: () => <Board /> },
  { match: /^\/counter$/, roles: ["tech", "owner"], render: (user) => <Counter user={user} /> },
  { match: /^\/pickup$/, roles: ["tech", "owner"], render: () => <Pickup /> },
  { match: /^\/studio$/, roles: ["owner"], render: () => <Studio /> },
  { match: /^\/rates$/, roles: ["owner"], render: () => <Rates /> },
];

export function App() {
  const location = useLocation();
  const path = location.pathname;
  const [user, setUser] = useState<User | null | undefined>(undefined);

  const track = /^\/track\/([A-Za-z0-9_-]+)$/.exec(path);
  useEffect(() => {
    if (!track) void request<User>("GET", "/api/me").then((result) => setUser(result.ok ? result.data : null));
  }, [track === null]);

  useEffect(() => {
    if (user && path === "/") navigate(START[user.role], true);
  }, [user, path]);

  if (track) return <Track token={track[1]} />;
  if (user === undefined) return <p className="loading muted">Loading…</p>;
  if (user === null) {
    return (
      <SignIn
        onSignedIn={(signedIn) => {
          setUser(signedIn);
          const screen = SCREENS.find((s) => s.match.test(path));
          if (!screen || !screen.roles.includes(signedIn.role)) navigate(START[signedIn.role], true);
        }}
      />
    );
  }

  const screen = SCREENS.find((s) => s.match.test(path));
  if (!screen) return null;
  const signOut = async () => {
    await request("DELETE", "/api/session");
    setUser(null);
    navigate("/", true);
  };

  return (
    <>
      <Header user={user} path={path} onSignOut={() => void signOut()} />
      {screen.roles.includes(user.role) ? (
        <main id="main">{screen.render(user, path)}</main>
      ) : (
        <main id="main" className="page">
          <div className="empty">
            <p>Your role can't open this page.</p>
            <Link href={START[user.role]}>Go to your start screen</Link>
          </div>
        </main>
      )}
    </>
  );
}
