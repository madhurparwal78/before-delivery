// The chrome every signed-in screen shares: the Library navigation and the outage banners.

import type { ReactNode } from "react";
import { BookOpen, Library, LogOut, MailX, Music, TriangleAlert, Layers } from "lucide-react";
import type { User } from "../../shared/api";
import { linkTo } from "../router";
import { MAIL_OUTAGE, STORE_OUTAGE, STORE_OUTAGE_ID, useStatus } from "../status";

interface ShellProps {
  user: User;
  path: string;
  onSignOut: () => void;
  children: ReactNode;
}

export function Shell({ user, path, onSignOut, children }: ShellProps) {
  const { status } = useStatus();
  const librarian = user.role === "principal_librarian" || user.role === "assistant_librarian";
  const section = user.role === "section_principal";
  const storeDown = status?.storage === "down";
  const links: { to: string; label: string; icon: ReactNode; current: boolean }[] = [];
  if (librarian) {
    links.push({ to: "/desk", label: "Programme desk", icon: <Layers aria-hidden="true" />, current: path.startsWith("/desk") });
    links.push({ to: "/rentals", label: "Rentals", icon: <Library aria-hidden="true" />, current: path === "/rentals" });
  }
  if (section) links.push({ to: "/section", label: "Section desk", icon: <Music aria-hidden="true" />, current: path === "/section" });
  if (section || user.role === "player") {
    links.push({ to: "/folder", label: "Folders", icon: <BookOpen aria-hidden="true" />, current: path.startsWith("/folder") });
  }
  return (
    <div className={`shell shell--${librarian && path.startsWith("/desk") ? "desk" : "page"}`}>
      <header className="topbar">
        <span className="topbar__brand">Quirewell</span>
        <nav aria-label="Library" className="topbar__nav">
          {links.map((link) => (
            <a key={link.to} className="navlink" aria-current={link.current ? "page" : undefined} {...linkTo(link.to)}>
              {link.icon}
              <span>{link.label}</span>
            </a>
          ))}
          <button type="button" className="navlink navlink--button" onClick={onSignOut}>
            <LogOut aria-hidden="true" />
            <span>Sign out</span>
          </button>
        </nav>
      </header>
      {storeDown && (librarian || section) && (
        <div role="alert" className="banner">
          <TriangleAlert aria-hidden="true" />
          <span>{STORE_OUTAGE}</span>
        </div>
      )}
      {status?.mail === "down" && librarian && (
        <div role="alert" className="banner">
          <MailX aria-hidden="true" />
          <span>{MAIL_OUTAGE}</span>
        </div>
      )}
      {storeDown && (
        <span id={STORE_OUTAGE_ID} hidden>
          {STORE_OUTAGE}
        </span>
      )}
      {children}
    </div>
  );
}
