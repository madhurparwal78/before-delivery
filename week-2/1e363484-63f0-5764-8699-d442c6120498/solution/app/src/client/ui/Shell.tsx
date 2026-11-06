// The signed-in frame: wordmark and the Main navigation. Children render once the person is known.

import { LogOut } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { request } from "../api";
import { Link, navigate, usePath } from "../router";
import type { Person } from "../types";

export function Wordmark() {
  return (
    <span className="wordmark">
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" className="wordmark-mark">
        <rect x="2.5" y="2.5" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M2.5 15 L9 9 L14 13 L21.5 6" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M6 21.5 L21.5 6" stroke="currentColor" strokeWidth="0.75" opacity="0.6" />
      </svg>
      Fluxseal
    </span>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const [person, setPerson] = useState<Person | null>(null);
  const path = usePath();

  useEffect(() => {
    void request<{ person: Person }>("GET", "/api/me").then((r) => {
      if (r.status === 200) setPerson(r.data.person);
    });
  }, []);

  const signOut = async () => {
    await request("DELETE", "/api/session", undefined, { allowUnauthenticated: true });
    navigate("/signin", { replace: true });
  };

  return (
    <div className="shell">
      <header className="masthead">
        <Wordmark />
        <nav aria-label="Main" className="main-nav">
          <Link href="/projects" aria-current={path === "/projects" ? "page" : undefined}>Projects</Link>
          {person?.org_role === "admin" && (
            <Link href="/admin/access" aria-current={path === "/admin/access" ? "page" : undefined}>Access</Link>
          )}
          <button type="button" className="btn btn-quiet" onClick={() => void signOut()}>
            <LogOut size={16} aria-hidden="true" />
            Sign out
          </button>
        </nav>
      </header>
      {person && children}
    </div>
  );
}
