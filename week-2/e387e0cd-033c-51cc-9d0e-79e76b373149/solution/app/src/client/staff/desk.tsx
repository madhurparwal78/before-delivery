// The staff frame: who is signed in, the workspace's business time, the rail (or the narrow top bar with the
// Sections sheet) and the Desk status live region.
import type { ComponentChildren } from "preact";
import { createContext } from "preact";
import { useContext, useEffect, useState } from "preact/hooks";
import { api } from "../api";
import { Link, navigate, usePlace } from "../router";
import { feedback, useStore } from "../store";
import { Dialog } from "../ui/Dialog";
import { Icon, type IconName } from "../ui/Icon";
import type { Role, SessionBody, WorkspaceBody } from "../types";
import { formatDateTime } from "../../shared/format";

export interface Desk {
  session: SessionBody;
  workspace: WorkspaceBody;
  role: Role;
  base: string;
  /** An instant in the workspace's business time: `Tue 6 Apr 2027, 11:00 Vilnius time`. */
  when: (instant: string) => string;
}

const DeskContext = createContext<Desk | null>(null);

export function useDesk(): Desk {
  return useContext(DeskContext)!;
}

const OFFICER: Role = "compliance_officer";
const ANALYST: Role = "compliance_analyst";
const OPS: Role = "operations_lead";
const FINANCE: Role = "finance_lead";
const SUPPORT: Role = "support_agent";
const EVERYONE: Role[] = [OFFICER, ANALYST, OPS, FINANCE, SUPPORT];

interface Section {
  label: string;
  path: string;
  icon: IconName;
  roles: Role[];
}

const SECTIONS: Section[] = [
  { label: "Withdrawals", path: "cases", icon: "cases", roles: EVERYONE },
  { label: "Review queue", path: "review", icon: "review", roles: [OFFICER, ANALYST, SUPPORT] },
  { label: "Incoming messages", path: "messages", icon: "messages", roles: [OFFICER, ANALYST, OPS, SUPPORT] },
  { label: "Counterparties", path: "counterparties", icon: "counterparties", roles: EVERYONE },
  { label: "Rules", path: "rules", icon: "rules", roles: EVERYONE },
  { label: "Daily report", path: "reports/daily", icon: "report", roles: [OFFICER, ANALYST] },
  { label: "Months", path: "months", icon: "months", roles: [OFFICER, FINANCE] },
  { label: "Regulator's files", path: "files", icon: "files", roles: [OFFICER, ANALYST, SUPPORT] },
  { label: "Partner keys", path: "partner-keys", icon: "keys", roles: [OFFICER] },
  { label: "Members", path: "members", icon: "members", roles: [OFFICER] },
  { label: "Directory listing", path: "listing", icon: "listing", roles: [OFFICER] },
];

function SectionLinks({ desk, onPick }: { desk: Desk; onPick?: () => void }) {
  const { path } = usePlace();
  return (
    <ul class="section-links">
      {SECTIONS.filter((s) => s.roles.includes(desk.role)).map((s) => {
        const href = `${desk.base}/${s.path}`;
        const active = path === href || path.startsWith(`${href}/`);
        return (
          <li key={s.path}>
            <Link href={href} class="section-link" aria-current={active ? "page" : undefined} onClick={onPick}>
              <Icon name={s.icon} />
              <span>{s.label}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

async function signOut(): Promise<void> {
  await api("DELETE", "/api/session", { quiet: true });
  navigate("/sign-in");
}

/** The live region for staff feedback, and the sign-in link a session refusal offers. */
export function DeskStatus() {
  const current = useStore(feedback);
  const { path, search } = usePlace();
  return (
    <div class={`desk-status${current ? ` tone-${current.tone}` : ""}`}>
      <p role="status" aria-label="Desk status" class="desk-status-text">{current?.text ?? ""}</p>
      {current?.signIn === "again" && (
        <Link class="desk-status-link" href={`/sign-in?next=${encodeURIComponent(path + search)}`}>Sign in again</Link>
      )}
      {current?.signIn === "only" && <Link class="desk-status-link" href="/sign-in">Sign in</Link>}
    </div>
  );
}

function Wordmark() {
  return (
    <span class="wordmark">
      <svg class="wordmark-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.5" />
        <circle cx="12" cy="12" r="3" fill="currentColor" />
        <path d="M12 3.5v-2M12 22.5v-2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      </svg>
      Lanternline
    </span>
  );
}

function Frame({ desk, children }: { desk: Desk; children: ComponentChildren }) {
  const [sections, setSections] = useState(false);
  const [restore, setRestore] = useState(true);
  return (
    <div class="staff">
      <a class="skip-link" href="#main">Skip to the screen</a>
      <nav aria-label="Workspace" class="rail">
        <div class="rail-head">
          <Wordmark />
          <p class="rail-workspace">{desk.workspace.name}</p>
          <p class="rail-city">{desk.workspace.city}</p>
        </div>
        <SectionLinks desk={desk} />
        <div class="rail-foot">
          <p class="rail-member">{desk.session.member.name}</p>
          <button type="button" class="button button-quiet button-icon-text" onClick={signOut}>
            <Icon name="signout" />
            <span>Sign out</span>
          </button>
        </div>
      </nav>
      <header class="topbar">
        <Wordmark />
        <p class="topbar-workspace"><span>{desk.workspace.name}</span><span class="topbar-city">{desk.workspace.city}</span></p>
        <button type="button" class="button button-quiet button-icon-text" onClick={() => { setRestore(true); setSections(true); }}>
          <Icon name="menu" />
          <span>Sections</span>
        </button>
      </header>
      <Dialog open={sections} label="Sections" kind="sheet" restoreFocus={restore} onClose={() => setSections(false)}>
        <SectionLinks desk={desk} onPick={() => { setRestore(false); setSections(false); }} />
        <div class="sheet-foot">
          <p class="rail-member">{desk.session.member.name} · {desk.workspace.city}</p>
          <button type="button" class="button button-quiet button-icon-text" onClick={signOut}>
            <Icon name="signout" />
            <span>Sign out</span>
          </button>
        </div>
      </Dialog>
      <main id="main" class="staff-main">
        <DeskStatus />
        {children}
      </main>
    </div>
  );
}

/** Loads the member and the workspace for a staff route; a signed-out visit goes to sign-in and comes back. */
export function StaffShell({ slug, children }: { slug: string; children: ComponentChildren }) {
  const [desk, setDesk] = useState<Desk | null>(null);
  const [missing, setMissing] = useState(false);
  const { path, search } = usePlace();
  useEffect(() => {
    let live = true;
    (async () => {
      const session = await api<SessionBody>("GET", "/api/session", { quiet: true });
      if (!live) return;
      if (!session.ok) {
        navigate(`/sign-in?next=${encodeURIComponent(path + search)}`, { replace: true, keepFeedback: true });
        return;
      }
      const ws = await api<{ workspace: WorkspaceBody }>("GET", `/api/w/${slug}`, { quiet: true });
      if (!live) return;
      if (!ws.ok) {
        setMissing(true);
        return;
      }
      const w = ws.data.workspace;
      setDesk({
        session: session.data, workspace: w, role: session.data.member.role, base: `/w/${slug}`,
        when: (instant) => formatDateTime(instant, w.timeZone, w.city),
      });
    })();
    return () => {
      live = false;
    };
  }, [slug]);
  if (missing) return <MissingPage />;
  if (!desk) return <div class="boot" aria-busy="true"><DeskStatus /></div>;
  return (
    <DeskContext.Provider value={desk}>
      <Frame desk={desk}>{children}</Frame>
    </DeskContext.Provider>
  );
}

export function MissingPage() {
  return (
    <main class="centered-page">
      <section class="centered-card">
        <h1 tabIndex={-1}>Page not found</h1>
        <p>We couldn't find that page.</p>
        <a class="button button-quiet" href="/">Go to the directory</a>
      </section>
    </main>
  );
}

/** A screen the member's role may not open. */
export function RoleRefused({ title }: { title: string }) {
  return (
    <section class="work">
      <h1 tabIndex={-1}>{title}</h1>
      <p class="note note-refusal"><Icon name="alert" size={18} /><span>Your role can't do this.</span></p>
    </section>
  );
}
