import { useState, type KeyboardEvent } from "react";
import { Link, navigate, usePath } from "../lib/router.tsx";
import { useSession } from "../lib/session.tsx";
import { currentSection, SECTIONS } from "../lib/sections.ts";
import { Dialog } from "./Dialog.tsx";
import { HamburgerIcon, LogoMark } from "./Icons.tsx";

function Logo({ to }: { to: string }) {
  return (
    <Link to={to} className="logo" aria-label="Fernsquare home">
      <LogoMark />
      <span className="logo__word" aria-hidden="true">Fernsquare</span>
    </Link>
  );
}

/** The bar of signed-out pages and of pages the person cannot open: only the logo. */
export function PublicTopBar() {
  return (
    <header className="topbar">
      <div className="topbar__inner">
        <Logo to="/" />
      </div>
    </header>
  );
}

export function WorkspaceTopBar({ workspaceId }: { workspaceId: string }) {
  const path = usePath();
  const { signOut } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const section = currentSection(path, workspaceId);
  const base = `/w/${workspaceId}`;

  const leave = async () => {
    await signOut();
    setMenuOpen(false);
    navigate("/signin");
  };

  return (
    <>
      <header className="topbar">
        <div className="topbar__inner">
          <Logo to={`${base}/explorer`} />
          <nav aria-label="Workspace" className="topbar__nav">
            {SECTIONS.map((item) => (
              <Link key={item.path} to={`${base}/${item.path}`} aria-current={section === item.path ? "page" : undefined}>
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="topbar__actions">
            <Link to={`${base}/submit`} className="pill pill--solid pill--bar">Submit blob</Link>
            <button type="button" className="menu-button" onClick={() => setMenuOpen(true)} aria-haspopup="dialog">
              <HamburgerIcon />
              <span className="menu-button__label">Menu</span>
            </button>
          </div>
        </div>
      </header>
      {menuOpen && (
        <Dialog label="Menu" onClose={() => setMenuOpen(false)} className="menu-dialog">
          <h2 className="dialog__title">Menu</h2>
          <ul className="menu-list">
            <li><Link to={`${base}/members`} onClick={() => setMenuOpen(false)}>Members</Link></li>
            <li><Link to={`${base}/ledger`} onClick={() => setMenuOpen(false)}>Ledger</Link></li>
            <li><button type="button" onClick={() => void leave()}>Sign out</button></li>
          </ul>
        </Dialog>
      )}
    </>
  );
}

/** Below 768 px the five sections are a tablist directly under the bar; each tab opens that panel's route. */
export function WorkspaceTabs({ workspaceId }: { workspaceId: string }) {
  const path = usePath();
  const section = currentSection(path, workspaceId);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'));
    const index = tabs.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowRight") tabs[(index + 1) % tabs.length]?.focus();
    else if (event.key === "ArrowLeft") tabs[(index - 1 + tabs.length) % tabs.length]?.focus();
    else if (event.key === " ") {
      event.preventDefault();
      (document.activeElement as HTMLElement).click();
    }
  };

  return (
    <div role="tablist" aria-label="Workspace panels" className="tabs" onKeyDown={onKeyDown}>
      {SECTIONS.map((item) => (
        <Link key={item.path} to={`/w/${workspaceId}/${item.path}`} role="tab" aria-selected={section === item.path}
          tabIndex={section === item.path || (section === null && item.path === "explorer") ? 0 : -1} className="tab">
          {item.label}
        </Link>
      ))}
    </div>
  );
}
