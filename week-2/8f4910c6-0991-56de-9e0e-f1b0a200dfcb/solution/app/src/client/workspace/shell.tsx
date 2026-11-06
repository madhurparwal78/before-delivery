// The signed-in frame.
//
// <Shell rail={optional page content for the rail, e.g. the board's Offices nav and Talent list}>…</Shell>
// - ≥ 1024px: a 232px left office rail (brand, `navigation "Workspace"`, rail content, Sign out) beside a
//   full-width main area. 768–1023px: the rail becomes a top bar. ≤ 767px: a compact bar with a Menu button.
// - Shows the ended-session banner (copy + "Sign in again") whenever the session module reports one.
// <WorkspaceGuard roles> wraps every workspace page (the router layout does this): not signed in →
// /sign-in?return=…, a role without access → its home.

import { useEffect, useState, type ReactNode } from "react";
import { Link, navigate, useLocation } from "../router.js";
import { HOMES, loadMember, signOut, useSession, type Role } from "../session.js";
import { SessionBanner } from "../ui/session-ui.js";
import { Button } from "../ui/button.js";
import { PHONE, useMediaQuery } from "../ui/media.js";

interface NavItem {
  label: string;
  href: string;
  roles: Role[];
}

const STAFF_DIRECTOR: Role[] = ["agency_director"];

const NAV: NavItem[] = [
  { label: "Overview", href: "/workspace/overview", roles: STAFF_DIRECTOR },
  { label: "Board", href: "/workspace/board", roles: ["agency_director", "booker"] },
  { label: "Bookings", href: "/workspace/bookings", roles: ["agency_director", "booker", "accounts_lead"] },
  { label: "Licences", href: "/workspace/licences", roles: ["agency_director", "accounts_lead"] },
  { label: "Statements", href: "/workspace/statements", roles: ["agency_director", "accounts_lead"] },
  { label: "Packages", href: "/workspace/packages", roles: ["agency_director", "booker"] },
  { label: "Applications", href: "/workspace/applications", roles: ["agency_director", "scout"] },
  { label: "Roster", href: "/workspace/roster", roles: STAFF_DIRECTOR },
  { label: "Members", href: "/workspace/members", roles: STAFF_DIRECTOR },
  { label: "Rate cards", href: "/workspace/rate-cards", roles: STAFF_DIRECTOR },
  { label: "Offices", href: "/workspace/offices", roles: STAFF_DIRECTOR },
  { label: "My calendar", href: "/workspace/me", roles: ["talent"] },
];

export function WorkspaceGuard({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const { status, member } = useSession();
  const { pathname, query } = useLocation();
  useEffect(() => {
    if (status === "loading") void loadMember();
    if (status === "signed-out") {
      const here = pathname + (query.toString() ? `?${query.toString()}` : "");
      navigate(`/sign-in?return=${encodeURIComponent(here)}`, { replace: true });
    }
    if (status === "signed-in" && member && roles && !roles.includes(member.role)) {
      navigate(HOMES[member.role], { replace: true });
    }
  }, [status, member, roles, pathname, query]);
  if (status !== "signed-in" || !member || (roles && !roles.includes(member.role))) {
    return <main className="page"><p className="muted">Loading the workspace…</p></main>;
  }
  return <>{children}</>;
}

export function Shell({ rail, children }: { rail?: ReactNode; children: ReactNode }) {
  const { member } = useSession();
  const { pathname } = useLocation();
  const phone = useMediaQuery(PHONE);
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const items = NAV.filter((item) => member && item.roles.includes(member.role));
  return (
    <div className="shell">
      <header className="rail">
        <Link href={member ? HOMES[member.role] : "/sign-in"} className="brand">Rungboard</Link>
        {phone ? (
          <button type="button" className="btn-quiet menu-toggle" aria-expanded={open} aria-controls="workspace-menu"
            onClick={() => setOpen(!open)}>Menu</button>
        ) : null}
        <div id="workspace-menu" className="rail-menu" hidden={phone && !open}>
          <nav aria-label="Workspace" className="rail-nav">
            <ul>
              {items.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} aria-current={pathname.startsWith(item.href) ? "page" : undefined}
                    onClick={() => setOpen(false)}>{item.label}</Link>
                </li>
              ))}
            </ul>
          </nav>
          {rail ? <div className="rail-extra">{rail}</div> : null}
          <div className="rail-foot">
            {member ? <p className="who">{member.name}</p> : null}
            <Button variant="quiet" pending={leaving} pendingLabel="Signing out…" onClick={async () => {
              setLeaving(true);
              await signOut();
              navigate("/sign-in");
            }}>Sign out</Button>
          </div>
        </div>
      </header>
      <main className="workspace-main">
        <SessionBanner />
        {children}
      </main>
    </div>
  );
}
