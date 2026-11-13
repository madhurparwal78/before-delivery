import { LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Wordmark } from "../components";
import { useSession } from "../lib/session";

export function RequireQuizmaster({ children }: { children: ReactNode }) {
  const { session } = useSession();
  if (session.status === "signedOut") return <Navigate to="/host/login" replace />;
  if (session.status === "loading") return <div className="host-loading" aria-busy="true" />;
  return <>{children}</>;
}

export function HostShell({ children }: { children: ReactNode }) {
  const { signOut } = useSession();
  const navigate = useNavigate();
  return (
    <div className="host">
      <header className="host-header">
        <Link to="/host" className="host-brand" aria-label="Lastbell decks">
          <Wordmark />
        </Link>
        <nav className="host-nav" aria-label="Host">
          <Link to="/host/nights">Past nights</Link>
          <button
            type="button"
            onClick={() => {
              void signOut().then(() => navigate("/host/login", { replace: true }));
            }}
          >
            <LogOut size={18} strokeWidth={1.75} aria-hidden="true" />
            Sign out
          </button>
        </nav>
      </header>
      <main className="host-main">{children}</main>
    </div>
  );
}
