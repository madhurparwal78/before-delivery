// The console shell: device identity and presence, the live-update hub, the Console updates region,
// the top bar, the footer, the Search dialog and the Keyboard shortcuts dialog.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiFailure, get, post, setDevice, setUnreachableHandler, getDevice, type Device } from "./api";
import { graphemeCount, plural } from "./format";
import { Dialog, Link, MenuIcon, PlusIcon, SearchIcon, Wordmark, dialogsOpen, useInterval, useLayout, useLocationKey, useDialog } from "./ui";

interface LiveEvent {
  type: string;
  device_id?: string;
  device_name?: string;
  pen_id?: string;
  defect_id?: string;
  farm_id?: string;
  farm_name?: string;
  pen_ids?: string[];
  number?: number;
  revision?: number;
  pen_name?: string;
}

interface ShellValue {
  deviceId: string;
  deviceName: string;
  devices: Device[];
  refreshDevices: () => Promise<Device[]>;
  chooseDevice: (id: string) => void;
  announce: (text: string) => void;
  subscribe: (fn: (event: LiveEvent) => void) => () => void;
  presence: () => Promise<void>;
  openShortcuts: () => void;
}

const ShellContext = createContext<ShellValue | null>(null);
export function useShell(): ShellValue {
  const value = useContext(ShellContext);
  if (!value) throw new Error("shell missing");
  return value;
}

export function useLive(fn: (event: LiveEvent) => void): void {
  const { subscribe } = useShell();
  const latest = useRef(fn);
  latest.current = fn;
  useEffect(() => subscribe((event) => latest.current(event)), [subscribe]);
}

export const isTyping = (el: Element | null): boolean => {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return !["button", "checkbox", "radio", "submit", "file"].includes((el as HTMLInputElement).type);
  return ["combobox", "searchbox", "textbox"].includes(el.getAttribute("role") ?? "");
};

function announcement(event: LiveEvent): string | null {
  const who = event.device_name ?? "Another device";
  switch (event.type) {
    case "defect.created": return `${who} marked ${event.defect_id}`;
    case "defect.updated": return `${who} updated ${event.defect_id}`;
    case "defect.removed": return `${who} removed ${event.defect_id}`;
    case "defect.repaired": return `${who} recorded a repair on ${event.defect_id}`;
    case "defect.restored": return `${who} restored revision ${event.revision} of ${event.pen_name}`;
    case "link.created": return "Report link created";
    case "link.revoked": return "Report link revoked";
    case "link.regenerated": return "Report link regenerated";
    default: return null;
  }
}

const NAV: [string, string][] = [["Pens", "/"], ["Dives", "/dives"], ["Imports", "/imports"], ["Reports", "/reports"], ["Devices", "/devices"]];

export function ConsoleShell({ children }: { children: ReactNode }) {
  const [deviceId, setDeviceId] = useState(getDevice());
  const [devices, setDevices] = useState<Device[]>([]);
  const [message, setMessage] = useState("");
  const listeners = useRef(new Set<(event: LiveEvent) => void>());
  const beat = useRef<Promise<void>>(Promise.resolve());
  const [shortcuts, setShortcuts] = useState(false);
  const idRef = useRef(deviceId);
  idRef.current = deviceId;

  const announce = useCallback((text: string) => setMessage(text), []);
  useEffect(() => { setUnreachableHandler(() => setMessage("Pensight server unreachable — changes are not saved")); }, []);

  const refreshDevices = useCallback(async () => {
    const reply = await get<{ devices: Device[] }>("/api/devices", { silent: true });
    setDevices(reply.devices);
    return reply.devices;
  }, []);

  const heartbeat = useCallback(() => {
    beat.current = post(`/api/devices/${idRef.current}/heartbeat`, undefined, { silent: true }).then(() => undefined, () => undefined);
  }, []);

  useEffect(() => {
    heartbeat();
    void beat.current.then(() => refreshDevices().catch(() => undefined));
  }, [deviceId, heartbeat, refreshDevices]);
  useInterval(heartbeat, 5000);

  useEffect(() => {
    const source = new EventSource("/api/events");
    let opened = false;
    source.onopen = () => {
      if (opened) listeners.current.forEach((fn) => fn({ type: "resync" }));
      opened = true;
    };
    source.onmessage = (message) => {
      let event: LiveEvent;
      try { event = JSON.parse(message.data) as LiveEvent; } catch { return; }
      if (event.device_id !== idRef.current) {
        const text = announcement(event);
        if (text) setMessage(text);
      }
      listeners.current.forEach((fn) => fn(event));
    };
    return () => source.close();
  }, []);

  const value = useMemo<ShellValue>(() => ({
    deviceId,
    deviceName: devices.find((d) => d.id === deviceId)?.name ?? "",
    devices,
    refreshDevices,
    chooseDevice: (id: string) => { setDevice(id); setDeviceId(id); },
    announce,
    subscribe: (fn) => { listeners.current.add(fn); return () => { listeners.current.delete(fn); }; },
    presence: () => beat.current,
    openShortcuts: () => setShortcuts(true),
  }), [deviceId, devices, refreshDevices, announce]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "?" && !event.ctrlKey && !event.metaKey && !event.altKey && !isTyping(document.activeElement) && !dialogsOpen()) {
        event.preventDefault();
        setShortcuts(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <ShellContext.Provider value={value}>
      <div className="app">
        <TopBar />
        <main className="page">{children}</main>
        <Footer />
      </div>
      <div className="toast" role="status" aria-label="Console updates" key="toast"><span key={message} className="toast-text">{message}</span></div>
      {shortcuts && <ShortcutsDialog onClose={() => setShortcuts(false)} />}
    </ShellContext.Provider>
  );
}

function TopBar() {
  const layout = useLayout();
  const key = useLocationKey();
  const [menu, setMenu] = useState(false);
  const [search, setSearch] = useState(false);
  const path = location.pathname;
  void key;
  const current = (to: string) => (to === "/" ? path === "/" || path.startsWith("/pens") : path.startsWith(to));
  return (
    <header className="topbar">
      <Link to="/" className="home" aria-label="Pensight home"><Wordmark /></Link>
      {layout !== "phone" && (
        <nav aria-label="Main" className="mainnav">
          <ul>
            {NAV.map(([name, to]) => (
              <li key={name}><Link to={to} aria-current={current(to) ? "page" : undefined}>{name}</Link></li>
            ))}
          </ul>
        </nav>
      )}
      <div className="bar-actions">
        <button type="button" className="bar-button" onClick={() => setSearch(true)}><SearchIcon /><span>Search</span></button>
        {layout === "phone" && <button type="button" className="bar-button" onClick={() => setMenu(true)}><MenuIcon /><span>Menu</span></button>}
      </div>
      {menu && (
        <Dialog title="Menu" onClose={() => setMenu(false)} className="dialog-menu">
          <nav aria-label="Menu links">
            <ul className="menu-links">
              {NAV.map(([name, to]) => (
                <li key={name}><Link to={to} onNavigate={() => setMenu(false)} aria-current={current(to) ? "page" : undefined}>{name}</Link></li>
              ))}
            </ul>
          </nav>
          <div className="dialog-actions"><CloseButton /></div>
        </Dialog>
      )}
      {search && <SearchDialog onClose={() => setSearch(false)} />}
    </header>
  );
}

function Footer() {
  const layout = useLayout();
  const { openShortcuts } = useShell();
  const [open, setOpen] = useState<string | null>(null);
  const columns: [string, ReactNode][] = [
    ["Console", <ul key="c">{NAV.map(([name, to]) => <li key={name}><Link to={to}>{name}</Link></li>)}</ul>],
    ["Data", <ul key="d"><li><a href="/api/exports/defects.csv" download>Export all defects (CSV)</a></li></ul>],
    ["Help", <ul key="h"><li><button type="button" className="linklike" onClick={openShortcuts}>Keyboard shortcuts</button></li></ul>],
  ];
  return (
    <footer className="footer">
      <div className="footer-mark"><Wordmark large /></div>
      <div className="footer-columns">
        {columns.map(([name, body]) =>
          layout === "phone" ? (
            <div className="accordion" key={name}>
              <button type="button" aria-expanded={open === name} onClick={() => setOpen(open === name ? null : name)}>
                <span>{name}</span><PlusIcon className={open === name ? "plus open" : "plus"} />
              </button>
              {open === name && body}
            </div>
          ) : (
            <div className="footer-column" key={name}><h2>{name}</h2>{body}</div>
          ),
        )}
      </div>
    </footer>
  );
}

function SearchDialog({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState("");
  const [results, setResults] = useState<{ kind: string; id: string; label: string }[]>([]);
  const [status, setStatus] = useState("Type at least 2 characters");
  const seq = useRef(0);
  useEffect(() => {
    const mine = ++seq.current;
    const query = text.trim();
    if (graphemeCount(query) < 2) {
      setResults([]);
      setStatus("Type at least 2 characters");
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        const reply = await get<{ results: { kind: string; id: string; label: string }[] }>(`/api/search?q=${encodeURIComponent(query)}`);
        if (mine !== seq.current) return;
        setResults(reply.results);
        setStatus(`${reply.results.length} ${plural(reply.results.length, "result", "results")}`);
      } catch (error) {
        if (mine !== seq.current) return;
        setResults([]);
        setStatus(error instanceof ApiFailure ? error.message : "Pensight server unreachable — changes are not saved");
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [text]);
  const [penIds, setPenIds] = useState<Record<string, string>>({});
  useEffect(() => {
    get<{ pens: { id: string; name: string }[] }>("/api/pens", { silent: true })
      .then((reply) => setPenIds(Object.fromEntries(reply.pens.map((pen) => [pen.name, pen.id]))))
      .catch(() => undefined);
  }, []);
  const href = (r: { kind: string; id: string; label: string }) =>
    r.kind === "farm" ? `/#farm-${r.id}` : r.kind === "pen" ? `/pens/${r.id}` : `/pens/${penIds[r.label.split(" — ")[1] ?? ""] ?? ""}?defect=${r.id}`;
  return (
    <Dialog title="Search" onClose={onClose} className="dialog-search" initialFocus="input">
      <h2>Search</h2>
      <input type="search" aria-label="Search farms, pens and defects" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" spellCheck={false} />
      <p className="muted" role="status" aria-label="Search status">{status}</p>
      <ul role="list" aria-label="Search results" className="results">
        {results.map((r) => (
          <li key={`${r.kind}-${r.id}`}><Link to={href(r)} onNavigate={onClose}>{r.label}</Link></li>
        ))}
      </ul>
    </Dialog>
  );
}

const SHORTCUTS: [string, string][] = [
  ["Left / Right Arrow", "Orbit 15° (flat chart: pan one panel)"],
  ["Up / Down Arrow", "Tilt 10° (flat chart: pan one row)"],
  ["+ or = / -", "Zoom in / out"],
  ["U", "Unwrap the net wall"],
  ["W", "Wrap it back"],
  ["N / P", "Next / previous defect"],
  ["E or Enter on a pin", "Open the editor"],
  ["M", "Toggle marking mode"],
  ["Escape", "Close the editor or leave marking mode"],
  ["?", "Show this list"],
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Keyboard shortcuts" onClose={onClose}>
      <h2>Keyboard shortcuts</h2>
      <dl className="shortcuts">
        {SHORTCUTS.map(([keys, what]) => (<div key={keys}><dt>{keys}</dt><dd>{what}</dd></div>))}
      </dl>
      <div className="dialog-actions"><CloseButton /></div>
    </Dialog>
  );
}

function CloseButton() {
  const dialog = useDialog();
  return <button type="button" className="btn" onClick={() => dialog?.close()}>Close</button>;
}

