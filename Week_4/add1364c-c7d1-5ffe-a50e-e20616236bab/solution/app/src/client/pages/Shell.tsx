import { useEffect, useRef, useState, type ReactNode } from "react";
import { get } from "../lib/api";
import { useMedia } from "../lib/hooks";
import { Link, useRouter } from "../lib/router";
import { useEvent, useStore } from "../lib/store";
import { officeStamp } from "../lib/office";
import type { AuditEntry, AuditPage, Role } from "../lib/types";
import { KeyMark } from "../ui/art";

const NAV: { label: string; to: string; roles: Role[] }[] = [
  { label: "Drawer", to: "/desk", roles: ["office_manager", "managing_partner", "staff_accountant", "outside_bookkeeper"] },
  { label: "Rotations", to: "/rotations", roles: ["office_manager", "managing_partner"] },
  { label: "Reviews", to: "/reviews", roles: ["office_manager", "managing_partner"] },
  { label: "People", to: "/people", roles: ["office_manager", "managing_partner"] },
  { label: "Billing", to: "/billing", roles: ["office_manager", "managing_partner"] },
  { label: "Health", to: "/health", roles: ["office_manager", "managing_partner"] },
  { label: "Import", to: "/import", roles: ["office_manager"] },
  { label: "Audit", to: "/audit", roles: ["office_manager", "managing_partner"] },
  { label: "My travel", to: "/travel", roles: ["staff_accountant", "outside_bookkeeper"] },
];

export function LiveRegions() {
  const { status, alert } = useStore();
  return (
    <div className="live">
      <div role="status" aria-label="Desk status" className={`live-status ${status.text ? "has-text" : ""}`}>
        {status.text ? <span key={status.key}>{status.text}</span> : null}
      </div>
      <div role="alert" aria-label="Desk alert" className={`live-alert band ${alert.text ? "has-text" : ""}`}>
        {alert.text ? <span key={alert.key}>{alert.text}</span> : null}
      </div>
    </div>
  );
}

function TopBar() {
  const { me, office, signOut } = useStore();
  const { location } = useRouter();
  const narrow = useMedia("(max-width: 767px)");
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const links = me ? NAV.filter((item) => item.roles.includes(me.role)) : [];

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); menuButton.current?.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => { if (!narrow) setOpen(false); }, [narrow]);

  const showLinks = !narrow || open;
  return (
    <header className="topbar">
      <div className="wordmark"><KeyMark /><span>Wardhouse</span></div>
      {narrow ? (
        <button type="button" ref={menuButton} className="btn btn-quiet menu-btn" aria-expanded={open} aria-controls="desk-nav" onClick={() => setOpen((v) => !v)}>Menu</button>
      ) : null}
      <nav aria-label="Desk" id="desk-nav" className={`desk-nav ${narrow ? "desk-nav-over" : ""}`} hidden={!showLinks}>
        {showLinks ? (
          <ul>
            {links.map((item) => (
              <li key={item.to}>
                <Link to={item.to} aria-current={location.path === item.to || (item.to === "/desk" && location.path.startsWith("/desk/")) ? "page" : undefined}
                  onNavigate={() => { if (narrow) { setOpen(false); menuButton.current?.focus(); } }}>{item.label}</Link>
              </li>
            ))}
          </ul>
        ) : null}
      </nav>
      <div className="who">
        <span className="who-name">{me?.full_name}</span>
        <span className="who-stamp">{office ? officeStamp(office.date, office.time, office.offset) : ""}</span>
      </div>
      <button type="button" className="btn btn-quiet signout" onClick={() => void signOut()}>Sign out</button>
    </header>
  );
}

function BackOfDrawer() {
  const { auditTick } = useStore();
  const { location } = useRouter();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [load, setLoad] = useState(0);
  useEffect(() => {
    let live = true;
    get<AuditPage>("/api/audit?order=newest&limit=10").then((page) => { if (live) setEntries(page.entries); }).catch(() => undefined);
    return () => { live = false; };
  }, [auditTick, location.path, load]);
  useEvent("check-finished", () => setLoad((n) => n + 1));
  useEvent("rule-in-force", () => setLoad((n) => n + 1));
  useEvent("seat-confirmed", () => setLoad((n) => n + 1));
  return (
    <footer className="back-of-drawer">
      <div className="back-inner">
        <h2>Back of the drawer</h2>
        {entries.length === 0 ? <p className="back-empty">No entries yet today.</p> : (
          <ol className="back-list" aria-label="Newest entries">
            {entries.map((entry) => (
              <li key={entry.id}>
                <span className="fig">{entry.office_time} {entry.offset}</span>
                <span>{"system" in entry.actor ? entry.actor.system : entry.actor.name}</span>
                <span className="act">{entry.action}</span>
                <span className="subj">{entry.subject.name}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </footer>
  );
}

export function DeskShell({ children }: { children: ReactNode }) {
  const { me } = useStore();
  const hasBack = me?.role === "office_manager" || me?.role === "managing_partner";
  return (
    <div className={`shell ${hasBack ? "has-back" : ""}`}>
      <div className="front">
        <TopBar />
        <LiveRegions />
        <main id="main">{children}</main>
      </div>
      {hasBack ? <BackOfDrawer /> : null}
    </div>
  );
}

function PublicBar({ dark }: { dark?: boolean }) {
  return (
    <header className={`public-bar ${dark ? "on-ink" : ""}`}>
      <span className="pb-spacer" />
      <div className="wordmark"><KeyMark /><span>Wardhouse</span></div>
      <Link to="/sign-in" className="pb-signin">Sign in</Link>
    </header>
  );
}

export function PublicShell({ children, dark }: { children: ReactNode; dark?: boolean }) {
  return (
    <div className={`public ${dark ? "public-ink" : ""}`}>
      <PublicBar dark={dark} />
      <main id="main">{children}</main>
    </div>
  );
}
