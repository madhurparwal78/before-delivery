import React from "react";
import { Routes, Route, NavLink, Navigate, useNavigate, useLocation } from "react-router-dom";
import { api, type User } from "./api.js";
import { useSession, StatusChip } from "./shared.js";
import SignIn from "./screens/SignIn.js";
import Intake from "./screens/Intake.js";
import MyPieces from "./screens/MyPieces.js";
import PieceDetail from "./screens/PieceDetail.js";
import Board from "./screens/Board.js";
import Counter from "./screens/Counter.js";
import Pickup from "./screens/Pickup.js";
import Studio from "./screens/Studio.js";
import Rates from "./screens/Rates.js";
import Tracking from "./screens/Tracking.js";

const ROLE_LINKS: Record<string, Array<{ to: string; label: string }>> = {
  member: [
    { to: "/intake", label: "Intake" },
    { to: "/pieces", label: "My pieces" }
  ],
  tech: [
    { to: "/board", label: "Load board" },
    { to: "/counter", label: "Counter" },
    { to: "/pickup", label: "Pickup shelf" }
  ],
  owner: [
    { to: "/studio", label: "Studio" },
    { to: "/board", label: "Load board" },
    { to: "/counter", label: "Counter" },
    { to: "/pickup", label: "Pickup shelf" },
    { to: "/rates", label: "Rates" }
  ]
};

const ROLE_HOME: Record<string, string> = {
  member: "/intake",
  tech: "/board",
  owner: "/studio"
};

function Forbidden(): React.ReactElement {
  return (
    <main>
      <div className="pane" role="status">
        <p>Your role can't open this page.</p>
      </div>
    </main>
  );
}

function Shell({ user, onSignedOut, children }: { user: User; onSignedOut: () => void; children: React.ReactNode }): React.ReactElement {
  const navigate = useNavigate();
  const links = ROLE_LINKS[user.role] ?? [];
  return (
    <>
      <header className="app-header">
        <span className="studio-name">Brickfield Lane Clayhouse</span>
        <nav aria-label="Studio">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} className={({ isActive }) => (isActive ? "active" : "")}>
              {l.label}
            </NavLink>
          ))}
        </nav>
        <button
          onClick={() => {
            void api.del("/api/session").then(() => {
              onSignedOut();
              navigate("/");
            });
          }}
        >
          Sign out
        </button>
      </header>
      {children}
    </>
  );
}

function Guarded({ user, roles, children }: { user: User; roles: string[]; children: React.ReactNode }): React.ReactElement {
  if (!roles.includes(user.role)) {
    return <Forbidden />;
  }
  return <>{children}</>;
}

export default function App(): React.ReactElement {
  const { user, loading, reload } = useSession();
  const location = useLocation();
  const trackingMatch = location.pathname.startsWith("/track/");

  if (trackingMatch) {
    return <Tracking />;
  }

  if (loading) {
    return (
      <main>
        <div className="pane" role="status">
          <p>Loading…</p>
        </div>
      </main>
    );
  }

  if (!user) {
    return <SignIn onSignedIn={() => void reload()} />;
  }

  const home = ROLE_HOME[user.role] ?? "/";

  return (
    <Shell user={user} onSignedOut={() => void reload()}>
      <Routes>
        <Route path="/" element={<Navigate to={home} replace />} />
        <Route path="/intake" element={<Guarded user={user} roles={["member"]}><Intake /></Guarded>} />
        <Route path="/pieces" element={<Guarded user={user} roles={["member"]}><MyPieces /></Guarded>} />
        <Route path="/pieces/:number" element={<Guarded user={user} roles={["owner", "tech", "member"]}><PieceDetail /></Guarded>} />
        <Route path="/board" element={<Guarded user={user} roles={["owner", "tech"]}><Board /></Guarded>} />
        <Route path="/counter" element={<Guarded user={user} roles={["owner", "tech"]}><Counter /></Guarded>} />
        <Route path="/pickup" element={<Guarded user={user} roles={["owner", "tech"]}><Pickup /></Guarded>} />
        <Route path="/studio" element={<Guarded user={user} roles={["owner"]}><Studio /></Guarded>} />
        <Route path="/rates" element={<Guarded user={user} roles={["owner"]}><Rates /></Guarded>} />
        <Route path="*" element={<Forbidden />} />
      </Routes>
    </Shell>
  );
}
