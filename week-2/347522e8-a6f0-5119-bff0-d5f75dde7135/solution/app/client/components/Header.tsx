import { LogOut, Menu } from "lucide-react";
import { type KeyboardEvent, type MouseEvent, useEffect, useRef, useState } from "react";
import type { UserView } from "../../shared/api.js";
import { navigate, usePlace } from "../router.js";

const PHONE = matchMedia("(max-width: 767.98px)");

interface Link {
  href: string;
  label: string;
}

function linksFor(user: UserView): Link[] {
  return [
    { href: "/board", label: "Board" },
    ...(user.role === "renter" ? [{ href: "/kitchen", label: "My kitchen" }] : []),
    ...(user.role === "operator" ? [{ href: "/operator", label: "Operator" }] : []),
    ...(user.role !== "renter" ? [{ href: "/shift", label: "Shift" }] : []),
  ];
}

export function Header({ user, onSignOut }: { user: UserView; onSignOut: () => void }) {
  const { path } = usePlace();
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLUListElement>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (open) drawer.current?.querySelector("a")?.focus();
  }, [open]);

  const close = (): void => {
    setOpen(false);
    menu.current?.focus();
  };

  const follow = (event: MouseEvent<HTMLAnchorElement>, href: string): void => {
    event.preventDefault();
    setOpen(false);
    navigate(href);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (!open || !PHONE.matches) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const cycle: HTMLElement[] = [...(menu.current ? [menu.current] : []), ...(drawer.current?.querySelectorAll("a") ?? [])];
    const index = cycle.findIndex((el) => el === document.activeElement);
    event.preventDefault();
    const next = (index + (event.shiftKey ? -1 : 1) + cycle.length) % cycle.length;
    cycle[next]?.focus();
  };

  return (
    <header className="masthead" onKeyDown={onKeyDown}>
      <div className="masthead__bar">
        <p className="brand">
          Railside <span className="brand__by">by Brigade &amp; Bench</span>
        </p>
        <button
          ref={menu}
          type="button"
          className="button button--ghost masthead__menu"
          aria-expanded={open}
          aria-controls="main-nav-links"
          onClick={() => setOpen((value) => !value)}
        >
          <Menu aria-hidden="true" className="icon" />
          Menu
        </button>
        <nav aria-label="Main" className={`masthead__nav${open ? " masthead__nav--open" : ""}`}>
          <ul id="main-nav-links" ref={drawer} className="masthead__links">
            {linksFor(user).map((link) => (
              <li key={link.href}>
                <a href={link.href} className="masthead__link" aria-current={path === link.href ? "page" : undefined} onClick={(event) => follow(event, link.href)}>
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <span className="masthead__who">{user.name}</span>
        <button
          type="button"
          className="button button--ghost masthead__signout"
          disabled={signingOut}
          onClick={() => {
            setSigningOut(true);
            onSignOut();
          }}
        >
          <LogOut aria-hidden="true" className="icon" />
          Sign out
        </button>
      </div>
    </header>
  );
}
