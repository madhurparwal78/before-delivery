// The persistent header (brief: Screens and layout › Header): brand, main navigation (inline from
// tablet width, inside the Menu sheet on phones), Motion and Sound, Support, Sign in or Account.

import { useState } from "react";
import { Link, useLocation } from "../router.js";
import { useApp } from "../state.js";
import { Dialog } from "./Dialog.js";
import { Icon } from "./ui.js";

const NAV = [
  { href: "/", label: "Chapters" },
  { href: "/timeline", label: "Timeline" },
  { href: "/sources", label: "Sources" },
  { href: "/sessions", label: "Sessions" },
  { href: "/support", label: "Support" },
];

function MainNav({ onNavigate }: { onNavigate?: () => void }) {
  const { path } = useLocation();
  const current = (href: string) => (href === "/" ? path === "/" || path.startsWith("/chapters/") : path.startsWith(href));
  return (
    <nav aria-label="Main" className="main-nav">
      <ul>
        {NAV.map((item) => (
          <li key={item.href}>
            <Link href={item.href} aria-current={current(item.href) ? "page" : undefined} onNavigate={onNavigate}>
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Switch({ name, on, onToggle }: { name: string; on: boolean; onToggle: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} className="switch" onClick={onToggle}>
      <span className="switch-track" aria-hidden="true">
        <span className="switch-thumb" />
      </span>
      <span className="switch-label">{name}</span>
    </button>
  );
}

export function Header() {
  const app = useApp();
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <header className="site-header">
      <div className="header-row">
        <Link href="/" className="brand">
          Halden Reading Room
        </Link>
        <div className="header-nav">
          <MainNav />
        </div>
        <div className="header-tools">
          <Switch name="Motion" on={app.preferences.motion} onToggle={() => app.setPreference("motion", !app.preferences.motion)} />
          <Switch name="Sound" on={app.preferences.sound} onToggle={() => app.setPreference("sound", !app.preferences.sound)} />
          <button type="button" className="button button-quiet support-button" onClick={(e) => app.openPlan(e.currentTarget)}>
            Support
          </button>
          {app.user ? (
            <div className="account-tools">
              <span className="signed-in-name">{app.user.name}</span>
              {(app.user.role === "curator" || app.user.role === "lead_curator") && (
                <Link href="/studio" className="button button-quiet">
                  Studio
                </Link>
              )}
              {app.user.role === "manager" && (
                <Link href="/box-office" className="button button-quiet">
                  Box office
                </Link>
              )}
              <Link href="/account" className="button button-quiet">
                Account
              </Link>
              <button type="button" className="button button-quiet" onClick={() => void app.signOut()}>
                Sign out
              </button>
            </div>
          ) : (
            <button type="button" className="button" onClick={(e) => app.openSignIn(e.currentTarget)}>
              Sign in
            </button>
          )}
          <button type="button" className="button button-quiet menu-button" onClick={() => setMenuOpen(true)}>
            <Icon name="menu" />
            Menu
          </button>
        </div>
      </div>
      <Dialog open={menuOpen} label="Menu" variant="sheet" onClose={() => setMenuOpen(false)}>
        <p className="sheet-title">Halden Reading Room</p>
        <MainNav onNavigate={() => setMenuOpen(false)} />
      </Dialog>
    </header>
  );
}
