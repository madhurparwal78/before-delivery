import { useState, type ReactNode } from "react";
import type { Role } from "../../shared/rules";
import { api } from "../api";
import { Link, navigate, usePath } from "../router";
import { useMe, useSession } from "../session";
import { Dialog } from "./Dialog";
import { Icon } from "./Icon";

const LINKS: { href: string; label: string; role?: Role; member?: boolean }[] = [
  { href: "/markets", label: "Markets", member: true },
  { href: "/balance", label: "Balance", member: true },
  { href: "/orders", label: "Orders", member: true },
  { href: "/statements", label: "Statements", member: true },
  { href: "/profile", label: "Profile", member: true },
  { href: "/builder", label: "Builder", role: "builder" },
  { href: "/admin", label: "Admin", role: "market_admin" },
  { href: "/owner", label: "Owner", role: "org_owner" },
  { href: "/platform", label: "Platform", role: "founder_operator" },
];

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const me = useMe();
  const path = usePath();
  const links = LINKS.filter((link) => (link.role ? me.roles.includes(link.role) : me.venue !== null && link.member));
  return (
    <nav aria-label="Venue" className="nav">
      <ul>
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} aria-current={path.startsWith(link.href) ? "page" : undefined} onClick={onNavigate}>
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function SignOut() {
  const { refresh } = useSession();
  const signOut = async () => {
    await api("/api/session", { method: "DELETE" });
    navigate("/");
    refresh();
  };
  return (
    <button type="button" className="pill pill-quiet" onClick={() => void signOut()}>
      Sign out
    </button>
  );
}

/** Every signed-in screen: venue name left, navigation right; a Menu sheet below 768 px. */
export function Shell({ field, children, bare = false }: { field: "slate" | "sage" | "blush" | "olive"; children: ReactNode; bare?: boolean }) {
  const me = useMe();
  const [menu, setMenu] = useState(false);
  return (
    <div className={`field field-${field}`}>
      <header className="topbar">
        <Link href="/" className="venue-name">
          {me.venue?.name ?? "Plumtide Venue"}
        </Link>
        <div className="topbar-wide">
          <Navigation />
          <SignOut />
        </div>
        <button type="button" className="pill pill-quiet menu-button" onClick={() => setMenu(true)}>
          <Icon name="menu" />
          Menu
        </button>
      </header>
      <Dialog title="Menu" open={menu} onClose={() => setMenu(false)} variant="sheet" hideTitle>
        <button type="button" className="icon-button sheet-close" aria-label="Close menu" onClick={() => setMenu(false)}>
          <Icon name="close" />
        </button>
        <Navigation onNavigate={() => setMenu(false)} />
        <SignOut />
      </Dialog>
      <main id="main" className={bare ? "page page-home" : "page"}>
        {children}
      </main>
    </div>
  );
}
