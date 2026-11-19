import { PanelLeft, User } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link } from "../router.js";
import { useSession } from "../session.js";
import { focusables, trapTab } from "../focus.js";

/** The top bar: product name, Invitations and the Account menu (and the Collections button on a phone). */
export function TopBar({ onCollections }: { onCollections: (() => void) | null }): ReactNode {
  return (
    <header className="topbar">
      {onCollections ? (
        <button type="button" className="btn btn-icon" aria-label="Collections" onClick={onCollections}>
          <PanelLeft size={20} aria-hidden="true" />
        </button>
      ) : null}
      <Link to="/projects" className="brand">
        Jarful
      </Link>
      <span className="topbar-gap" />
      <Link to="/invites" className="topbar-link">
        Invitations
      </Link>
      <AccountMenu />
    </header>
  );
}

function AccountMenu(): ReactNode {
  const { state, signOut } = useSession();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !menu.current) return;
    focusables(menu.current)[0]?.focus();
    const away = (event: PointerEvent): void => {
      if (!menu.current?.contains(event.target as Node) && !button.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const close = (): void => {
    setOpen(false);
    button.current?.focus();
  };
  return (
    <div className="menu-anchor">
      <button ref={button} type="button" className="btn btn-icon-text" aria-haspopup="menu" aria-expanded={open} aria-label="Account" onClick={() => (open ? close() : setOpen(true))}>
        <User size={20} aria-hidden="true" />
        <span className="topbar-account-text" aria-hidden="true">
          Account
        </span>
      </button>
      {open ? (
        <div
          ref={menu}
          role="menu"
          aria-label="Account"
          className="menu"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              close();
            } else if (menu.current) trapTab(event, menu.current);
          }}
        >
          <p className="menu-who" role="presentation">
            {state.status === "in" ? state.user.name : ""}
          </p>
          <button type="button" role="menuitem" className="menu-item" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
