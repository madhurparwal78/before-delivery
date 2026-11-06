// The signed-in workspace: module rail, the list and detail panes, announcements, the knock
// dialog and presence heartbeats.
import { CalendarRange, DoorOpen, FileText, ListTodo, LogOut, MessagesSquare, Settings as SettingsIcon, UserRound } from "lucide-react";
import { useEffect, useRef } from "react";
import { api, type Person, type Workspace as WorkspaceRecord } from "../api";
import { KnockDialog } from "../modules/KnockDialog";
import { ChatModule } from "../modules/Chat";
import { CycleModule } from "../modules/Cycle";
import { DocsModule } from "../modules/Docs";
import { IssuesModule } from "../modules/Issues";
import { OfficeModule } from "../modules/Office";
import { AccountModule, SettingsModule } from "../modules/Settings";
import { navigate, type Location } from "../router";
import { AppProvider, useApp } from "../store";

const MODULES = [
  { id: "issues", label: "Issues", href: "/issues", Icon: ListTodo },
  { id: "cycle", label: "Cycle", href: "/cycle", Icon: CalendarRange },
  { id: "chat", label: "Chat", href: "/chat/inbox", Icon: MessagesSquare },
  { id: "docs", label: "Docs", href: "/docs", Icon: FileText },
  { id: "office", label: "Office", href: "/office", Icon: DoorOpen },
  { id: "settings", label: "Settings", href: "/settings", Icon: SettingsIcon },
] as const;

function Rail(props: { module: string; onSignOut: () => void }): JSX.Element {
  const app = useApp();
  return (
    <aside className="rail">
      <span className="rail-brand" aria-hidden="true">
        <span className="brand-mark" />
      </span>
      <nav aria-label="Modules" className="modules">
        {MODULES.filter((m) => m.id !== "settings" || app.isOwner).map(({ id, label, href, Icon }) => (
          <a
            key={id}
            href={href}
            className="module-link"
            aria-current={props.module === id ? "page" : undefined}
            onClick={(e) => {
              e.preventDefault();
              navigate(href);
            }}
          >
            <Icon aria-hidden="true" size={20} strokeWidth={1.5} />
            <span>{label}</span>
          </a>
        ))}
      </nav>
      {!app.isOwner && (
        <a
          href="/account"
          className="module-link account-link"
          aria-current={props.module === "account" ? "page" : undefined}
          onClick={(e) => {
            e.preventDefault();
            navigate("/account");
          }}
        >
          <UserRound aria-hidden="true" size={20} strokeWidth={1.5} />
          <span>Account</span>
        </a>
      )}
      <button type="button" className="sign-out" onClick={props.onSignOut}>
        <LogOut aria-hidden="true" size={20} strokeWidth={1.5} />
        <span>Sign out</span>
      </button>
    </aside>
  );
}

function Heartbeat(): null {
  const last = useRef(-30_000);
  useEffect(() => {
    const beat = (): void => {
      const now = performance.now();
      if (now - last.current < 30_000) return;
      last.current = now;
      void api("POST", "/api/presence/heartbeat", {}).catch(() => undefined);
    };
    window.addEventListener("pointerdown", beat);
    window.addEventListener("keydown", beat);
    return () => {
      window.removeEventListener("pointerdown", beat);
      window.removeEventListener("keydown", beat);
    };
  }, []);
  return null;
}

function Shell(props: { location: Location; onSignOut: () => void }): JSX.Element {
  const app = useApp();
  const segments = props.location.path.split("/").filter(Boolean);
  const module = segments[0] ?? "issues";
  const rest = segments.slice(1);
  let body: JSX.Element;
  switch (module) {
    case "cycle":
      body = <CycleModule rest={rest} />;
      break;
    case "chat":
      body = <ChatModule rest={rest} />;
      break;
    case "docs":
      body = <DocsModule rest={rest} />;
      break;
    case "office":
      body = <OfficeModule rest={rest} />;
      break;
    case "settings":
      body = <SettingsModule rest={rest} />;
      break;
    case "account":
      body = <AccountModule rest={rest} />;
      break;
    default:
      body = <IssuesModule rest={rest} search={props.location.search} />;
  }
  return (
    <div className="shell">
      <Rail module={module} onSignOut={props.onSignOut} />
      <main className="workarea">{body}</main>
      <div role="status" aria-label="Announcements" aria-live="polite" className="announcements">
        {app.announcement}
      </div>
      <KnockDialog />
      <Heartbeat />
    </div>
  );
}

export function Workspace(props: { person: Person; workspace: WorkspaceRecord; location: Location; onSignOut: () => void; onSignedOut: () => void; onNotice: () => void }): JSX.Element {
  return (
    <AppProvider person={props.person} workspace={props.workspace} onSignedOut={props.onSignedOut} onNotice={props.onNotice} onTrouble={props.onNotice}>
      <Shell location={props.location} onSignOut={props.onSignOut} />
    </AppProvider>
  );
}
