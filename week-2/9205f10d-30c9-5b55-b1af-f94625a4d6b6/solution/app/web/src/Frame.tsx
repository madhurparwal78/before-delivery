import { type ReactNode, useState } from "react";
import { Link, usePlace } from "./router";
import type { Role, User } from "./types";

export const HOME: Record<Role, string> = {
  coordinator: "/board",
  interpreter: "/open-seats",
  client_scheduler: "/requests",
  billing_admin: "/billing",
};

const LINKS: Record<Role, [string, string][]> = {
  coordinator: [
    ["Week board", "/board"],
    ["Credentials", "/credentials"],
  ],
  interpreter: [
    ["Open seats", "/open-seats"],
    ["My assignments", "/assignments"],
    ["Profile", "/profile"],
  ],
  client_scheduler: [
    ["Requests", "/requests"],
    ["New request", "/requests/new"],
    ["Invoices", "/invoices"],
  ],
  billing_admin: [
    ["Billing", "/billing"],
    ["Invoices", "/invoices"],
  ],
};

export function Frame({ user, onSignOut, children }: { user: User; onSignOut: () => void; children: ReactNode }) {
  const { path } = usePlace();
  const [menuOpen, setMenuOpen] = useState(false);
  const current = (href: string) => path === href || (href !== "/requests/new" && path.startsWith(`${href}/`) && !path.startsWith("/requests/new"));
  return (
    <div className="app">
      <header className="topbar">
        <Link to={HOME[user.role]} className="wordmark">
          <span className="wordmark-mark" aria-hidden="true" />
          Crosshand Relay
        </Link>
        <button
          type="button"
          className="button button--quiet menu-button"
          aria-expanded={menuOpen}
          aria-controls="main-nav"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
          Menu
        </button>
        <nav id="main-nav" className={`main-nav${menuOpen ? " main-nav--open" : ""}`} aria-label="Main">
          <ul>
            {LINKS[user.role].map(([label, href]) => (
              <li key={href}>
                <Link to={href} aria-current={current(href) ? "page" : undefined} onClick={() => setMenuOpen(false)}>
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="topbar-user">
          <span className="topbar-name">{user.display_name}</span>
          <button type="button" className="button button--quiet" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>
      <main className="main">{children}</main>
    </div>
  );
}
