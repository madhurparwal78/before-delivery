import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "../router";
import { hasRole, signOut, useSession } from "../session";
import { ChevronDownIcon, MenuIcon, UserIcon } from "./Icons";

export function Header() {
  const session = useSession();
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setNavOpen(false);
    setAccountOpen(false);
  }, [location.path, location.search]);

  useEffect(() => {
    if (!accountOpen) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (event instanceof MouseEvent && accountRef.current?.contains(event.target as Node)) return;
      setAccountOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [accountOpen]);

  const links = [
    { to: "/courts", label: "Courts", shown: true },
    { to: "/matches", label: "Matches", shown: true },
    { to: "/me", label: "My bookings", shown: true },
    { to: "/desk", label: "Desk", shown: hasRole(session, "desk") || hasRole(session, "manager") },
    { to: "/coach", label: "Coach", shown: hasRole(session, "coach") },
    { to: "/manager", label: "Manager", shown: hasRole(session, "manager") },
  ].filter((link) => link.shown);

  const signInTo = `/login?return=${encodeURIComponent(location.path + window.location.search)}`;

  return (
    <header className="site-header">
      <div className="site-header__bar">
        <Link to="/" className="wordmark">
          MARLOWE YARD
        </Link>
        <nav aria-label="Main" className="site-nav" data-open={navOpen}>
          {links.map((link) => (
            <Link key={link.to} to={link.to} aria-current={location.path === link.to ? "page" : undefined}>
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="site-header__actions">
          {session.state === "signed-out" && (
            <a className="pill pill--lime" href={signInTo}>
              Sign in
            </a>
          )}
          {session.state === "signed-in" && (
            <div className="account" ref={accountRef}>
              <button
                type="button"
                className="pill pill--lime pill--icon"
                aria-label="Account"
                aria-haspopup="menu"
                aria-expanded={accountOpen}
                onClick={() => setAccountOpen((open) => !open)}
              >
                <UserIcon />
                <ChevronDownIcon size={16} className="account__chevron" />
              </button>
              {accountOpen && (
                <div role="menu" aria-label="Account" className="account__menu">
                  <button type="button" role="menuitem" className="account__item" autoFocus onClick={signOut}>
                    Sign out
                  </button>
                </div>
              )}
            </div>
          )}
          <button
            type="button"
            className="pill pill--lime pill--menu"
            aria-label="Menu"
            aria-expanded={navOpen}
            onClick={() => setNavOpen((open) => !open)}
          >
            <MenuIcon />
          </button>
        </div>
      </div>
    </header>
  );
}
