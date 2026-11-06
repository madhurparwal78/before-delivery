import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { PAGES } from "../../shared/copy";
import { announcements, passageUpdates } from "../lib/announce";
import { api } from "../lib/api";
import { useWide } from "../lib/hooks";
import { navigate, useLocation } from "../lib/nav";
import { Button, Link } from "./Controls";
import { Dialog, useDialog } from "./Dialog";

export type Role = "fleet_director" | "charter_manager" | "finance_lead" | "captain" | "crew_member";

export interface Member {
  id: string;
  name: string;
  role: Role;
  workspaceSlug: string;
  workspaceName: string;
}

function LiveRegions({ planner }: { planner?: boolean }) {
  const [said, setSaid] = useState(announcements.current);
  const [update, setUpdate] = useState(passageUpdates.current);
  useEffect(() => announcements.subscribe(setSaid), []);
  useEffect(() => passageUpdates.subscribe(setUpdate), []);
  return (
    <>
      <div class="sr-only" role="status" aria-live="polite" aria-label="Announcements">
        {said}
      </div>
      {planner ? (
        <div class="sr-only" role="status" aria-live="polite" aria-label="Passage updates">
          {update}
        </div>
      ) : null}
    </>
  );
}

const NAV: { label: string; path: string; roles: Role[] }[] = [
  { label: "Today", path: "today", roles: ["fleet_director", "captain", "crew_member"] },
  { label: "Fleet", path: "fleet", roles: ["fleet_director", "charter_manager", "finance_lead", "captain", "crew_member"] },
  { label: "Holds", path: "holds", roles: ["fleet_director", "charter_manager", "finance_lead"] },
  { label: "Charters", path: "charters", roles: ["fleet_director", "charter_manager", "finance_lead", "captain"] },
  { label: "Passages", path: "passages", roles: ["fleet_director", "captain", "crew_member"] },
  { label: "Berths", path: "berths", roles: ["fleet_director", "captain"] },
  { label: "Shore power", path: "shore-power", roles: ["fleet_director", "captain"] },
  { label: "Brokers", path: "brokers", roles: ["fleet_director", "charter_manager"] },
  { label: "Tariffs", path: "tariffs", roles: ["fleet_director", "charter_manager", "finance_lead", "captain"] },
];

function NavLinks({ member, current, onPick }: { member: Member; current: string; onPick?: () => void }) {
  return (
    <nav aria-label="Workspace" class="nav">
      <ul>
        {NAV.filter((item) => item.roles.includes(member.role)).map((item) => {
          const href = `/w/${member.workspaceSlug}/${item.path}`;
          const here = current === href || current.startsWith(`${href}/`);
          return (
            <li key={item.path}>
              <Link href={href} class="nav__link" aria-current={here ? "page" : undefined} onClick={onPick}>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

let cached: Member | null = null;

/** Staff screens: the top bar with brand, workspace, navigation (or Menu below 1024 px) and Sign out. */
export function StaffShell({ children, planner }: { children: (member: Member) => ComponentChildren; planner?: boolean }) {
  const here = useLocation();
  const wide = useWide();
  const menu = useDialog();
  const [member, setMember] = useState<Member | null>(cached);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    void api<{ member: Member }>("GET", "/api/session").then((result) => {
      if (result.ok) {
        cached = result.data.member;
        setMember(result.data.member);
      } else if (!cached || result.status === 401) {
        cached = null;
        navigate(`/sign-in?return=${encodeURIComponent(location.pathname + location.search)}`, { replace: true });
      }
    });
  }, []);

  useEffect(() => {
    if (wide && menu.open) menu.hide();
  }, [wide]);

  const signOut = async () => {
    setSigningOut(true);
    await api("DELETE", "/api/session");
    cached = null;
    navigate("/sign-in");
  };

  return (
    <div class="app">
      <LiveRegions planner={planner} />
      <header class="topbar">
        <div class="topbar__inner">
          <div class="brand-block">
            <span class="brand">
              <span class="brand__mark" aria-hidden="true" />
              Tidewright
            </span>
            {member ? <span class="topbar__workspace">{member.workspaceName}</span> : null}
          </div>
          <div class="topbar__actions">
            {member && !wide ? (
              <Button variant="quiet" onClick={menu.show} aria-haspopup="dialog">
                Menu
              </Button>
            ) : null}
            <Button variant="quiet" onClick={signOut} disabled={signingOut}>
              Sign out
            </Button>
          </div>
        </div>
        {member && wide ? (
          <div class="topbar__nav">
            <NavLinks member={member} current={here.path} />
          </div>
        ) : null}
      </header>
      {member && !wide ? (
        <Dialog handle={menu} title="Menu" variant="menu" quietTitle>
          <NavLinks member={member} current={here.path} onPick={menu.hide} />
        </Dialog>
      ) : null}
      <main class="main" id="main">
        {member ? children(member) : null}
      </main>
    </div>
  );
}

export function PublicShell({ children }: { children: ComponentChildren }) {
  return (
    <div class="app app--public">
      <LiveRegions />
      <header class="topbar topbar--public">
        <div class="topbar__inner">
          <span class="brand">
            <span class="brand__mark" aria-hidden="true" />
            Tidewright
          </span>
        </div>
      </header>
      <main class="main" id="main">
        {children}
      </main>
    </div>
  );
}

export function NotFoundPage() {
  return (
    <section class="notice-page">
      <h1>{PAGES.notFound.heading}</h1>
      <p>{PAGES.notFound.body}</p>
      <p>
        <Link class="btn btn--primary" href="/sign-in">
          Sign in
        </Link>
      </p>
    </section>
  );
}

export function EndedPage() {
  return (
    <section class="notice-page">
      <h1>{PAGES.ended.heading}</h1>
      <p>{PAGES.ended.body}</p>
    </section>
  );
}

export function GonePage({ workspace }: { workspace: string }) {
  return (
    <section class="notice-page">
      <h1>{PAGES.gone.heading}</h1>
      <p>{PAGES.gone.body}</p>
      <p>
        <Link class="btn btn--primary" href={`/fleet/${workspace}`}>
          Browse the fleet
        </Link>
      </p>
    </section>
  );
}

interface Column<T> {
  label: string;
  cell: (row: T) => ComponentChildren;
  numeric?: boolean;
}

/** A named table that becomes stacked rows below 1024 px; it says so when it is empty. */
export function DataTable<T>({ name, columns, rows, empty, rowKey, captionHidden }: {
  name: string;
  columns: Column<T>[];
  rows: T[];
  empty: string;
  rowKey: (row: T) => string;
  captionHidden?: boolean;
}) {
  return (
    <div class="table-wrap">
      <table class="table" role="table" aria-label={name}>
        <caption class={captionHidden ? "sr-only" : "table__caption"}>{name}</caption>
        <thead role="rowgroup">
          <tr role="row">
            {columns.map((c) => (
              <th key={c.label} role="columnheader" scope="col" class={c.numeric ? "num" : undefined}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody role="rowgroup">
          {rows.map((row) => (
            <tr key={rowKey(row)} role="row">
              {columns.map((c) => (
                <td key={c.label} role="cell" data-label={c.label} class={c.numeric ? "num" : undefined}>
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length ? null : <p class="empty">{empty}</p>}
    </div>
  );
}
