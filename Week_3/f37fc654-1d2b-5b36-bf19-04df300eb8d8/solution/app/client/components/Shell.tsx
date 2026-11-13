// The top bar (role links; a drawer below 768 px) and the notice lane (banners, session, toasts).
import { useState, type ReactNode } from "react";
import { BANNERS } from "../../shared/copy";
import { call, signInHref } from "../lib/api";
import { navigate, currentRoute, useLocation } from "../lib/router";
import { notices } from "../lib/notices";
import { hasRole, useSession, type Me } from "../lib/session";
import { Dialog } from "./Dialog";
import { Icon } from "./icons";

function linksFor(me: Me | null): { href: string; label: string }[] {
  if (hasRole(me, "producer")) return [{ href: "/studio", label: "Studio" }, { href: "/studio/jobs", label: "Jobs" }];
  if (hasRole(me, "crew")) return [{ href: "/crew", label: "Install days" }];
  if (hasRole(me, "client")) return [{ href: "/commissions", label: "Commissions" }, { href: "/settings/crm", label: "CRM settings" }];
  return [];
}

export function AppLink({ href, children, className, current }: { href: string; children: ReactNode; className?: string; current?: boolean }) {
  return (
    <a
      href={href}
      className={className}
      aria-current={current ? "page" : undefined}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        navigate(href);
      }}
    >
      {children}
    </a>
  );
}

async function signOut(): Promise<void> {
  await call("/auth/logout", { method: "POST" }).catch(() => undefined);
  location.assign("/");
}

export function TopBar() {
  const { me, status } = useSession();
  const { path } = useLocation();
  const [open, setOpen] = useState(false);
  const links = linksFor(me);
  const account = status === "in"
    ? <button type="button" onClick={() => void signOut()}>Sign out</button>
    : <a href={signInHref(currentRoute())}>Sign in</a>;
  return (
    <header className="topbar">
      <AppLink href="/" className="wordmark">Spindrift Rooms</AppLink>
      <nav className="nav" aria-label="Main">
        {links.map((l) => <AppLink key={l.href} href={l.href} current={path === l.href}>{l.label}</AppLink>)}
        {account}
      </nav>
      <button type="button" className="button menu-button" aria-expanded={open} onClick={() => setOpen(true)}>
        <Icon name="menu" /> Menu
      </button>
      {open && (
        <>
          <div className="drawer-scrim" onClick={() => setOpen(false)} />
          <Dialog label="Navigation" className="drawer" onClose={() => setOpen(false)}>
            <button type="button" className="button graphite" onClick={() => setOpen(false)}>
              <Icon name="x" /> Close menu
            </button>
            <nav aria-label="Main" onClick={(event) => (event.target as HTMLElement).closest("a") && setOpen(false)}>
              {links.map((l) => <AppLink key={l.href} href={l.href} current={path === l.href}>{l.label}</AppLink>)}
              {status === "in"
                ? <button type="button" className="link" onClick={() => void signOut()}>Sign out</button>
                : <a href={signInHref(currentRoute())}>Sign in</a>}
            </nav>
          </Dialog>
        </>
      )}
    </header>
  );
}

export function NoticeLane() {
  const { toasts, down } = notices.use();
  const { ended } = useSession();
  return (
    <div className="lane">
      <div role="status" aria-label="Notices" className="lane-toasts">
        {toasts.map((t) => <p key={t.id} className="chip-note">{t.text}</p>)}
      </div>
      <div role="status" aria-label="Session" className="lane-session">
        {ended && (
          <div className="chip-note">
            <span>Your session ended. Sign in again — what you entered is kept.</span>
            <button type="button" className="button primary" onClick={() => location.assign(signInHref(currentRoute()))}>Sign in</button>
          </div>
        )}
      </div>
      <div role="status" aria-label="Service notices" className="lane-banners">
        {down.map((service) => <p key={service} className="chip-note">{BANNERS[service]}</p>)}
      </div>
    </div>
  );
}
