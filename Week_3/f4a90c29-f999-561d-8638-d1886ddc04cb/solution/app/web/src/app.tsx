import { useEffect, useState } from "preact/hooks";
import { call, describe, send } from "./api";
import { CalendarPage } from "./calendar";
import { EditEventDialog, NewEventDialog } from "./form";
import { EventPage } from "./eventpage";
import { conflictAsk$, scopeAsk$, type Scope, type ScopeAsk } from "./eventsvc";
import { startLive, stopLive } from "./live";
import {
  FindPage, Landing, NotFound, PrintsPage, SearchPage, SettingsPage, SharePage, SharingPage, SignIn, TrashPage, ZoneRulesPage,
} from "./pages";
import { navigate, useLocation } from "./router";
import { announce } from "./status";
import { connection$, loadBase, loadMe, me$, reminders$ } from "./state";
import { useStore } from "./store";
import { syncClock } from "./time";
import { Modal } from "./ui";
import type { Me } from "./types";

function ScopeDialog() {
  const ask = useStore(scopeAsk$);
  return ask ? <ScopeChoice ask={ask} /> : null;
}

function ScopeChoice({ ask }: { ask: ScopeAsk }) {
  const [scope, setScope] = useState<Scope>("this");
  const deleting = ask.kind === "delete";
  const options: [Scope, string][] = [["this", "This event"], ["following", "This and following events"], ["all", "All events"]];
  return (
    <Modal label={deleting ? "Delete repeating event" : "Edit repeating event"} onClose={() => ask.resolve(null)}>
      <form class="dialog-form" onSubmit={(e) => { e.preventDefault(); ask.resolve(scope); }}>
        <h2>{deleting ? "Delete repeating event" : "Edit repeating event"}</h2>
        <p class="muted">{ask.title}</p>
        <div role="radiogroup" aria-label="Apply to" class="choice">
          {options.map(([value, text]) => (
            <label class="radio" key={value}>
              <input type="radio" name="apply-to" checked={scope === value} onChange={() => setScope(value)} data-autofocus={value === "this" ? "" : undefined} />
              {text}
            </label>
          ))}
        </div>
        <div class="actions">
          <button type="submit" class="primary">{deleting ? "Delete" : "OK"}</button>
          <button type="button" onClick={() => ask.resolve(null)}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

function ConflictDialog() {
  const ask = useStore(conflictAsk$);
  if (!ask) return null;
  const { current } = ask;
  const rows: [string, string][] = [
    ["Title", current.title], ["Location", current.location ?? ""], ["Notes", current.notes ?? ""],
    ["Starts", current.start_local.replace("T", " ")], ["Ends", current.end_local.replace("T", " ")],
  ];
  return (
    <Modal label="This event changed" onClose={() => ask.resolve("keep")}>
      <h2>This event changed</h2>
      <p>{`${ask.winner} saved this first. Their values are shown here.`}</p>
      <ul aria-label="Winning values" class="plain-list">
        {rows.map(([name, value]) => <li key={name}>{`${name}: ${value}`}</li>)}
      </ul>
      <div class="actions">
        <button type="button" class="primary" onClick={() => ask.resolve("reapply")} data-autofocus>Reapply my changes</button>
        <button type="button" onClick={() => ask.resolve("keep")}>Keep theirs</button>
      </div>
    </Modal>
  );
}

function Reminders() {
  const list = useStore(reminders$);
  const [minutes, setMinutes] = useState<Record<string, string>>({});
  return (
    <div class="reminders">
      {list.map((r) => (
        <section role="region" aria-label={`Reminder: ${r.title}`} class="reminder" key={r.id}>
          <p>{r.text}</p>
          <div class="reminder-actions">
            <label for={`snooze-${r.id}`} class="visually-hidden">Snooze for</label>
            <select id={`snooze-${r.id}`} aria-label="Snooze for" value={minutes[r.id] ?? "10"} onChange={(e) => setMinutes({ ...minutes, [r.id]: e.currentTarget.value })}>
              {[5, 10, 30].map((m) => <option value={String(m)} key={m}>{`${m} minutes`}</option>)}
            </select>
            <button type="button" onClick={async () => {
              const n = Number(minutes[r.id] ?? "10");
              announce(`Snoozing ${r.title}...`);
              try {
                await send("POST", `/api/reminders/${r.id}/snooze`, { minutes: n });
                reminders$.set((l) => l.filter((x) => x.id !== r.id));
                announce(`Snoozed ${r.title} for ${n} minutes.`);
              } catch (e) {
                announce(describe(e));
              }
            }}>Snooze</button>
            <button type="button" onClick={() => reminders$.set((l) => l.filter((x) => x.id !== r.id))}>Dismiss</button>
          </div>
        </section>
      ))}
    </div>
  );
}

function Shell({ me, path, children }: { me: Me; path: string; children: preact.ComponentChildren }) {
  const connection = useStore(connection$);
  const [open, setOpen] = useState(false);
  const links: [string, string][] = me.role === "guest"
    ? [["Calendar", "/calendar"], ["Settings", "/settings"]]
    : [["Calendar", "/calendar"], ["Find a time", "/find"], ["Search", "/search"], ["Trash", "/trash"], ["Zone rules", "/zone-rules"], ["Sharing", "/sharing"], ["Settings", "/settings"],
       ...(me.role === "office_manager" ? [["Prints", "/prints"] as [string, string]] : [])];
  const signOut = async () => {
    await call("DELETE", "/api/session").catch(() => undefined);
    stopLive();
    me$.set(null);
    navigate("/signin", true);
  };
  return (
    <div class="shell">
      {path === "/calendar" && (
        <a class="skip" href="#cal-grid" onClick={(e) => { e.preventDefault(); document.getElementById("cal-grid")?.querySelector<HTMLElement>("[tabindex='0'], button")?.focus(); }}>Skip to calendar</a>
      )}
      <header class="topbar">
        <span class="brand">Wren Calendar</span>
        <button type="button" class="menu-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>Menu</button>
        <nav aria-label="Main" class={open ? "open" : ""}>
          {links.map(([text, href]) => (
            <a key={href} href={href} aria-current={path === href ? "page" : undefined} onClick={(e) => { e.preventDefault(); setOpen(false); navigate(href); }}>{text}</a>
          ))}
          <button type="button" onClick={() => void signOut()}>Sign out</button>
        </nav>
        {path !== "/calendar" && connection.reconnecting && <span class="reconnect">Reconnecting. Changes will catch up.</span>}
      </header>
      <Reminders />
      {children}
      <NewEventDialog me={me} />
      <EditEventDialog me={me} />
    </div>
  );
}

export function App() {
  const me = useStore(me$);
  const loc = useLocation();
  useEffect(() => {
    void loadMe();
    const timer = setInterval(() => void syncClock(), 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (me) {
      void loadBase();
      startLive();
    } else stopLive();
  }, [me?.id]);
  const path = loc.path;
  const share = /^\/share\/([^/]+)$/.exec(path);
  let page;
  if (path === "/") page = <Landing />;
  else if (path === "/signin") page = <SignIn />;
  else if (share) page = <SharePage token={share[1]} />;
  else if (me === undefined) page = <main class="column"><p class="quiet">Loading.</p></main>;
  else if (me === null) {
    const signedInOnly = /^\/(calendar|find|search|trash|sharing|zone-rules|prints|settings|events\/[^/]+)$/.test(path);
    if (signedInOnly) navigate("/signin", true);
    page = signedInOnly ? null : <NotFound />;
  } else {
    const event = /^\/events\/([^/]+)$/.exec(path);
    let inner;
    if (path === "/calendar") inner = <CalendarPage />;
    else if (event) inner = <EventPage id={event[1]} key={event[1]} />;
    else if (path === "/find") inner = <FindPage />;
    else if (path === "/search") inner = <SearchPage />;
    else if (path === "/trash") inner = <TrashPage />;
    else if (path === "/sharing") inner = <SharingPage />;
    else if (path === "/zone-rules") inner = <ZoneRulesPage />;
    else if (path === "/prints") inner = <PrintsPage />;
    else if (path === "/settings") inner = <SettingsPage />;
    else inner = <NotFound />;
    page = <Shell me={me} path={path}>{inner}</Shell>;
  }
  return (
    <>
      {page}
      <ScopeDialog />
      <ConflictDialog />
    </>
  );
}
