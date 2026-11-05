// The top bar: wordmark, the role's navigation (behind a Menu button in the narrow band) and Sign out.

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { LogOut, Menu as MenuIcon, X } from "lucide-react";
import type { Role } from "../../shared/api.js";
import { call } from "../api.js";
import { Link, useApp, useUser } from "../app.js";
import { useBand } from "../hooks.js";
import { QUICK, tween, type Motion } from "../motion.js";

const NAV: Record<Role, { to: string; label: string }[]> = {
  owner: [{ to: "/register", label: "Register" }, { to: "/price-lists", label: "Price lists" }, { to: "/schools", label: "Schools" }],
  tech: [{ to: "/register", label: "Register" }],
  parent: [{ to: "/family", label: "My family" }],
  director: [{ to: "/roster", label: "Roster" }],
};

export function TopBar(): ReactNode {
  const user = useUser();
  const { location, navigate, setUser } = useApp();
  const band = useBand();
  const narrow = band === "narrow";
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLUListElement>(null);
  const motion = useRef<Motion>(null);
  const wasShown = useRef(false);
  wasShown.current = shown;

  useLayoutEffect(() => {
    if (!narrow) {
      setOpen(false);
      setShown(false);
    }
  }, [narrow]);

  useLayoutEffect(() => {
    const node = panel.current;
    if (!narrow || !node) return;
    motion.current?.stop();
    const place = (v: number): void => {
      node.style.opacity = String(v);
      node.style.transform = v === 1 ? "" : `translateY(${(v - 1) * 6}px)`;
    };
    if (open) {
      setShown(true);
      node.querySelector<HTMLAnchorElement>("a")?.focus();
      motion.current = tween(0, 1, QUICK, place);
    } else if (wasShown.current) {
      motion.current = tween(Number(node.style.opacity || "1"), 0, QUICK, place, { onComplete: () => setShown(false) });
    }
  }, [open, narrow]);

  useLayoutEffect(() => () => motion.current?.stop(), []);

  const close = (refocus: boolean): void => {
    setOpen(false);
    if (refocus) menuButton.current?.focus();
  };

  const links = NAV[user.role].map((item) => (
    <li key={item.to}>
      <Link to={item.to} className={`nav__link ${location.path === item.to ? "nav__link--current" : ""}`}
        onFollow={() => close(false)}>{item.label}</Link>
    </li>
  ));
  const signOut = (
    <button type="button" className="button button--ghost signout" onClick={() => {
      void call("DELETE", "/api/session").then(() => {
        setUser(null);
        navigate("/", { replace: true });
      });
    }}>
      <LogOut size={18} aria-hidden="true" />
      <span>Sign out</span>
    </button>
  );

  return (
    <header className="topbar">
      <a className="wordmark" href={NAV[user.role][0].to} onClick={(event) => {
        event.preventDefault();
        navigate(NAV[user.role][0].to);
      }}>
        <span className="wordmark__mark" aria-hidden="true">K&amp;B</span>
        <span className="wordmark__name">Keel &amp; Bell</span>
      </a>
      <nav aria-label="Main" id="main-nav" className={narrow ? "nav nav--narrow" : "nav"}
        onKeyDown={(event) => {
          if (narrow && open && event.key === "Escape") {
            event.preventDefault();
            close(true);
          }
        }}>
        {narrow && (
          <button ref={menuButton} type="button" className="button button--ghost menu-button" aria-expanded={open}
            aria-controls="main-nav" onClick={() => setOpen(!open)}>
            {open ? <X size={20} aria-hidden="true" /> : <MenuIcon size={20} aria-hidden="true" />}
            <span>Menu</span>
          </button>
        )}
        {(!narrow || open || shown) && (
          <ul ref={panel} id="main-nav-links" className={narrow ? "nav__panel" : "nav__list"}
            inert={narrow && !open} aria-hidden={narrow && !open ? true : undefined}>
            {links}
            {narrow && <li>{signOut}</li>}
          </ul>
        )}
      </nav>
      {!narrow && signOut}
    </header>
  );
}
