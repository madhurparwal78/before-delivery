// The frame every signed-in screen shares: top bar, role navigation and the lead megalitre counters.
import { ClipboardList, FileText, Gauge, LayoutGrid, LogOut, ScrollText, Users } from "lucide-react";
import type { ReactNode } from "react";
import type { Role } from "../../shared/roles.ts";
import { ROLE_LABEL, api, fromMilli, navigate, toMilli, usePoll, useLocation, useRevealed } from "../lib.ts";
import type { Allocation, Totals, User } from "../types.ts";
import { Figure, FigureStack } from "./Figures.tsx";
import { Search } from "./Search.tsx";

const NAV: Record<Role, { href: string; label: string; icon: typeof Gauge }[]> = {
  grower: [
    { href: "/grower", label: "Allocation", icon: Gauge },
    { href: "/grower/orders/new", label: "New order", icon: ClipboardList },
  ],
  operator: [{ href: "/field", label: "Gate cards", icon: Gauge }],
  dispatcher: [
    { href: "/board", label: "Channel board", icon: LayoutGrid },
    { href: "/contractors", label: "Contractors", icon: Users },
  ],
  clerk: [
    { href: "/packs", label: "Packs", icon: FileText },
    { href: "/packs/new", label: "New pack", icon: ScrollText },
    { href: "/contractors", label: "Contractors", icon: Users },
  ],
  reviewer: [{ href: "/review", label: "Review", icon: FileText }],
};

function Wordmark() {
  return (
    <span className="wordmark">
      <svg viewBox="0 0 32 32" aria-hidden="true" className="wordmark-mark">
        <path d="M4 10 9 26h14l5-16" fill="none" stroke="currentColor" strokeWidth="2.5" />
        <rect x="12" y="8" width="8" height="14" fill="currentColor" />
        <path d="M16 3v5" stroke="currentColor" strokeWidth="2.5" />
      </svg>
      Ditchbook
    </span>
  );
}

export function BareTopBar() {
  return (
    <header className="topbar topbar-bare">
      <Wordmark />
    </header>
  );
}

export function TopBar({ user }: { user: User }) {
  const { path } = useLocation();
  const signOut = async () => {
    await api("/api/session", { method: "DELETE" });
    navigate("/sign-in", true);
  };
  return (
    <header className="topbar">
      <div className="topbar-row">
        <Wordmark />
        <nav aria-label="Ditchbook" className="nav">
          {NAV[user.role].map(({ href, label, icon: Icon }) => (
            <a
              key={href}
              href={href}
              className="nav-link"
              aria-current={path === href ? "page" : undefined}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey) return;
                event.preventDefault();
                navigate(href);
              }}
            >
              <Icon size={16} aria-hidden="true" />
              {label}
            </a>
          ))}
        </nav>
        <Search />
        <div className="topbar-user">
        <div className="whoami">
          <span className="whoami-name">{user.name}</span>
          <span className="whoami-role">{ROLE_LABEL[user.role]}</span>
        </div>
        <button type="button" className="btn btn-quiet" onClick={signOut}>
          <LogOut size={16} aria-hidden="true" />
          Sign out
        </button>
        </div>
      </div>
    </header>
  );
}

/** The grower's Allocation counter: `<remaining> ML of <allocation> ML left`. A new `reread` value
 * asks `GET /api/me/allocation` again at once. */
export function AllocationCounter({ reread = 0 }: { reread?: number }) {
  const { data } = usePoll(() => api<Allocation>("/api/me/allocation"), [reread]);
  return (
    <section className="lead" role="region" aria-labelledby="allocation-heading">
      <h2 id="allocation-heading" className="lead-label">Allocation</h2>
      {data ? (
        <p className="lead-line">
          <span className="lead-figure num">{data.remaining_ml}</span>{" "}
          <span className="lead-caption">ML of <span className="num">{data.allocation_ml}</span> ML left</span>
        </p>
      ) : (
        <p className="lead-line muted">Loading…</p>
      )}
    </section>
  );
}

/** The district's committed and delivered ML: sums over every channel of `GET /api/totals`. */
export function DistrictTotals() {
  const { data } = usePoll(() => api<Totals>("/api/totals"), []);
  const sum = (key: "committed_ml" | "delivered_ml") => {
    if (!data) return "…";
    return fromMilli(data.channels.reduce((total, c) => total + toMilli(c[key]), 0n));
  };
  return (
    <section className="lead lead-totals" aria-label="District totals">
      <FigureStack>
        <Figure label="Committed ML" value={sum("committed_ml")} unit="ML" size="xl" />
        <Figure label="Delivered ML" value={sum("delivered_ml")} unit="ML" size="xl" />
      </FigureStack>
    </section>
  );
}

/** A screen: its lead megalitre counter first under the top bar, then its heading and content. */
export function Page({ title, lead, children, wide = false }: { title: ReactNode; lead?: ReactNode; children: ReactNode; wide?: boolean }) {
  const revealed = useRevealed();
  return (
    <main className={`page${wide ? " page-wide" : ""}${revealed ? "" : " page-pending"}`} id="main" aria-busy={!revealed}>
      {lead}
      <h1 className="page-title">{title}</h1>
      {children}
    </main>
  );
}
