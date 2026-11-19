import { useEffect, useState, type ReactNode } from "react";
import { ADMIN_KINDS } from "../../shared/screens.js";
import { homeScreen } from "../../shared/types.js";
import { del, get, put } from "../lib/api.js";
import { Modal } from "../lib/dialog.js";
import { useTopics } from "../lib/live.js";
import { Link, navigate, useLocation } from "../lib/router.js";
import { useSession } from "../lib/session.js";
import { Button, useViewport } from "../lib/ui.js";
import { BellIcon, MenuIcon } from "./icons.js";

const DESK_TEXT = "File storage is unreachable. Ticket work continues; uploads are queued and exports will retry when storage returns.";
const PORTAL_TEXT = "Attachments are paused while file storage is unreachable. Your request still goes through.";

interface Queue {
  id: number;
  name: string;
}

function useQueues(enabled: boolean): Queue[] {
  const [queues, setQueues] = useState<Queue[]>([]);
  useEffect(() => {
    if (!enabled) return;
    void get<{ filters: Array<Queue & { shared: boolean }> }>("/api/filters?table=incident").then((r) => setQueues(r.filters.filter((f) => f.shared).map((f) => ({ id: f.id, name: f.name }))));
  }, [enabled]);
  return queues;
}

function useUnread(): number {
  const session = useSession();
  const [unread, setUnread] = useState(0);
  const load = (): void => void get<{ unread: number }>("/api/inbox").then((r) => setUnread(r.unread));
  useEffect(() => {
    if (session.status === "ready") load();
  }, [session.status, session.user?.username]);
  useTopics(session.status === "ready" ? ["inbox"] : [], load);
  return unread;
}

function Banner({ onMenu }: { onMenu: () => void }): JSX.Element {
  const session = useSession();
  const unread = useUnread();
  return (
    <header className="banner">
      <Link to="/" className="wordmark">
        Ferrocline
      </Link>
      <div className="banner-right">
        <WorkspaceSelect />
        {session.status === "ready" ? (
          <Link to="/inbox" className="inbox-link" aria-label={`Inbox, ${unread} unread`}>
            <BellIcon />
            <span aria-hidden="true">{unread > 99 ? "99+" : unread}</span>
          </Link>
        ) : null}
        <button type="button" className="menu-button" onClick={onMenu}>
          <MenuIcon />
          <span>Menu</span>
        </button>
      </div>
    </header>
  );
}

function WorkspaceSelect(): JSX.Element | null {
  const session = useSession();
  if (!session.isOperator || session.impersonating) return null;
  return (
    <label className="workspace-select">
      <span className="sr-only">Workspace</span>
      <select aria-label="Workspace" value={session.workspace} onChange={(event) => void put("/api/session/workspace", { workspace: event.target.value }).then(() => session.refresh())}>
        <option value="live">Live workspace</option>
        <option value="test">Test workspace</option>
      </select>
    </label>
  );
}

function TestWorkspaceBlock(): JSX.Element | null {
  const session = useSession();
  if (!session.isOperator || session.impersonating || session.workspace !== "test") return null;
  return (
    <div className="test-workspace-row">
      <p className="test-workspace">Test workspace</p>
    </div>
  );
}

function ImpersonationBanner(): JSX.Element | null {
  const session = useSession();
  if (!session.impersonating) return null;
  return (
    <section className="impersonation" aria-label="Impersonation">
      <p>
        Impersonating {session.impersonating.display_name} ({session.impersonating.username}). Everything you do is recorded.
      </p>
      <Button
        variant="outline"
        onClick={() =>
          void del("/api/impersonate").then(async () => {
            await session.refresh();
            navigate("/desk");
          })
        }
      >
        Stop impersonating
      </Button>
    </section>
  );
}

function StorageBanner(): JSX.Element | null {
  const session = useSession();
  const [down, setDown] = useState(false);
  useEffect(() => {
    if (session.status !== "ready") return;
    void get<{ storage: string }>("/api/storage").then((r) => setDown(r.storage === "unavailable"));
  }, [session.status]);
  useTopics(session.status === "ready" ? ["storage"] : [], (message) => setDown(message.data.storage === "unavailable"));
  if (!down || session.status !== "ready") return null;
  return (
    <section className="storage-banner" aria-label="Storage status">
      <p>{session.isDesk ? DESK_TEXT : PORTAL_TEXT}</p>
    </section>
  );
}

function Links({ onNavigate }: { onNavigate: () => void }): JSX.Element {
  const session = useSession();
  const roles = session.user?.roles ?? [];
  const has = (...wanted: string[]): boolean => wanted.some((r) => roles.includes(r as never));
  const viewport = useViewport();
  const deskRole = has("operator", "technician", "approver", "manager");
  const queues = useQueues(deskRole && viewport !== "desktop");
  const [flows, setFlows] = useState<Array<{ id: number; name: string }>>([]);
  useEffect(() => {
    if (session.isOperator) void get<{ workflows: Array<{ id: number; name: string }> }>("/api/workflows").then((r) => setFlows(r.workflows));
  }, [session.isOperator, session.workspace]);
  const link = (to: string, text: string): JSX.Element => (
    <li key={to}>
      <Link to={to} onClick={onNavigate}>
        {text}
      </Link>
    </li>
  );
  return (
    <>
      <ul className="drawer-list">
        {link("/", "Ferrocline")}
        {session.user ? link(homeScreen(roles), "Your home") : link("/login", "Sign in")}
        {session.user ? link("/portal", "Ask the desk") : null}
        {session.user ? link("/inbox", "Inbox") : null}
        {deskRole ? link("/desk", "Desk") : null}
        {has("operator", "technician", "manager") ? link("/desk/map", "Service map") : null}
        {has("operator", "technician", "approver") ? link("/desk/changes/calendar", "Change calendar") : null}
        {has("operator", "technician", "approver") ? link("/desk/boards/Change board", "Change board agenda") : null}
        {has("operator", "approver") ? link("/approve", "Your votes") : null}
        {has("operator", "technician") ? link("/desk/oncall", "On call") : null}
        {has("operator", "technician") ? link("/pages", "Pages") : null}
        {has("operator", "technician") ? link("/desk/dashboards/desk-overview", "Desk overview") : null}
        {has("operator", "manager") ? link("/dashboards/department-standing", "Department standing") : null}
        {has("operator", "technician", "manager") ? link("/desk/exports", "Exports") : null}
        {has("operator") ? link("/desk/config-sets", "Configuration sets") : null}
        {has("operator") ? link("/desk/imports", "Imports") : null}
      </ul>
      {queues.length > 0 ? (
        <nav aria-label="Queues">
          <h2 className="drawer-heading">Queues</h2>
          <ul className="drawer-list">{queues.map((q) => link(`/desk?queue=${q.id}`, q.name))}</ul>
        </nav>
      ) : null}
      {session.isOperator ? (
        <nav aria-label="Rules and settings">
          <h2 className="drawer-heading">Rules and settings</h2>
          <ul className="drawer-list">{Object.entries(ADMIN_KINDS).map(([slug, kind]) => link(`/desk/admin/${slug}`, kind.plural))}</ul>
          {flows.length > 0 ? (
            <>
              <h2 className="drawer-heading">Workflows</h2>
              <ul className="drawer-list">{flows.map((f) => link(`/desk/workflows/${f.id}`, f.name))}</ul>
            </>
          ) : null}
        </nav>
      ) : null}
      {session.user ? (
        <Button
          variant="outline"
          onClick={() => {
            onNavigate();
            void session.signOut();
          }}
        >
          Sign out
        </Button>
      ) : null}
    </>
  );
}

export function Shell({ children }: { children: ReactNode }): JSX.Element {
  const [menu, setMenu] = useState(false);
  const { path } = useLocation();
  useEffect(() => setMenu(false), [path]);
  return (
    <div className="shell">
      <Banner onMenu={() => setMenu(true)} />
      <TestWorkspaceBlock />
      <ImpersonationBanner />
      <StorageBanner />
      {children}
      {menu ? (
        <Modal label="Navigation" onClose={() => setMenu(false)} sheet={false} className="drawer">
          <div className="drawer-head">
            <h2 className="drawer-title">Navigation</h2>
            <Button variant="outline" onClick={() => setMenu(false)}>
              Close
            </Button>
          </div>
          <Links onNavigate={() => setMenu(false)} />
        </Modal>
      ) : null}
    </div>
  );
}
