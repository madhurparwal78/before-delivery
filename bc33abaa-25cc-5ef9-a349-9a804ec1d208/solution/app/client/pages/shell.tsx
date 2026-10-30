// The signed-in app shell: top bar, role-aware workspace navigation and the Service status banner.
import { createContext, type ComponentChildren } from "preact";
import { useContext, useEffect, useLayoutEffect, useState } from "preact/hooks";
import type { Member, Subscription, WorkspaceSummary } from "../../shared/api-types.js";
import { localTime } from "../../shared/format.js";
import { can, type Action } from "../../shared/permissions.js";
import { ApiError, currentOutages, get, onOutageChange, post, type Outage } from "../api.js";
import { Button, Icon, Link, Mark, navigate } from "../ui.js";

export interface Session { member: Member; workspace: WorkspaceSummary; subscription: Subscription; overdueInvoice: string | null }

const SessionContext = createContext<{ session: Session; refresh: () => Promise<void> } | null>(null);

export function useSession(): { session: Session; refresh: () => Promise<void> } {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession outside the app shell");
  return value;
}

export const allowed = (session: Session, action: Action) => can({ kind: "member", role: session.member.role }, action);

const LINKS: { label: string; href: string; action: Action }[] = [
  { label: "Dashboard", href: "/app", action: "workspace.read" },
  { label: "Scenes", href: "/app/scenes", action: "scene.read" },
  { label: "Members", href: "/app/members", action: "workspace.read" },
  { label: "Agents", href: "/app/agents", action: "member.manage" },
  { label: "Audit", href: "/app/audit", action: "member.manage" },
  { label: "Billing", href: "/app/billing", action: "billing" },
  { label: "Settings", href: "/app/settings", action: "workspace.settings" },
];

export const OUTAGE_COPY: Record<Outage, string> = {
  file_storage: "File storage is unavailable. Your edits are saved; uploads, versions and publishing will resume when it is back.",
  billing: "Billing is unavailable right now. Nothing was charged. Editing and publishing keep working.",
};

export const READ_ONLY_COPY = {
  trial: "Your trial has ended. Start a paid plan to keep editing.",
  dunning: "This workspace is read-only until the overdue invoice is paid.",
  cancelled: "This subscription is cancelled. The workspace is read-only.",
};

/** The read-only copy for a suspended or cancelled subscription, or null while the workspace is writable. */
export function readOnlyCopy(sub: Subscription): string | null {
  if (sub.state === "cancelled") return READ_ONLY_COPY.cancelled;
  if (sub.state === "suspended") return sub.graceEndsAt ? READ_ONLY_COPY.dunning : READ_ONLY_COPY.trial;
  return null;
}

function ServiceStatus({ session }: { session: Session }) {
  const [outages, setOutages] = useState(currentOutages());
  useLayoutEffect(() => onOutageChange(() => setOutages(currentOutages())), []);
  const sub = session.subscription;
  const overdue = session.overdueInvoice;
  const lines: { text: string; alert: boolean }[] = outages.map((o) => ({ text: OUTAGE_COPY[o], alert: true }));
  if (sub.state === "past_due" && overdue && sub.graceEndsAt) {
    lines.push({ text: `Payment failed. Pay invoice ${overdue} by ${localTime(sub.graceEndsAt, session.workspace.timeZone)} to keep publishing.`, alert: true });
  }
  const readOnly = readOnlyCopy(sub);
  if (readOnly) lines.push({ text: readOnly, alert: true });
  return (
    <div role="status" aria-label="Service status" aria-live="polite" class="banner">
      {lines.map((line) => <p key={line.text} class={`notice${line.alert ? " alert" : ""}`}>{line.text}</p>)}
    </div>
  );
}

export function AppShell({ path, children }: { path: string; children: ComponentChildren }) {
  const [session, setSession] = useState<Session | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const refresh = async () => {
    try {
      setSession(await get<Session>("/api/me"));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) navigate("/login");
    }
  };
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 5000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => setMenuOpen(false), [path]);
  if (!session) return <div class="app"><div class="topbar"><span class="brand"><Mark />Orrery Studio</span></div></div>;
  const signOut = async () => { await post("/api/auth/logout"); navigate("/login"); };
  const current = (href: string) => (href === "/app" ? path === "/app" || path === "/app/" : path.startsWith(href));
  return (
    <SessionContext.Provider value={{ session, refresh }}>
      <div class="app">
        <header class="topbar">
          <Link class="brand" href="/app" aria-label="Orrery Studio dashboard"><Mark /></Link>
          <div class="who">
            <span class="workspace-name truncate" title={session.workspace.name}>{session.workspace.name}</span>
            <span class="muted small truncate" title={session.member.name}>{session.member.name}</span>
          </div>
          <Button class="menu-button quiet" aria-expanded={menuOpen ? "true" : "false"} aria-controls="workspace-nav" onClick={() => setMenuOpen(!menuOpen)}>
            <Icon name="menu" />Menu
          </Button>
          <nav id="workspace-nav" aria-label="Workspace" class={`workspace-nav${menuOpen ? " open" : ""}`}>
            <ul>
              {LINKS.filter((l) => allowed(session, l.action)).map((l) => (
                <li key={l.href}><Link href={l.href} aria-current={current(l.href) ? "page" : undefined}>{l.label}</Link></li>
              ))}
            </ul>
            <Button class="quiet" onClick={() => { void signOut(); }}><Icon name="out" />Sign out</Button>
          </nav>
        </header>
        <ServiceStatus session={session} />
        <main>{children}</main>
      </div>
    </SessionContext.Provider>
  );
}
