// Every page's frame: skip link, Main navigation (phone drawer), studio search, the outage banner and the footer.
import type { ComponentChildren } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { api } from "../api";
import { useFocusTrap } from "./Dialog";
import { useMedia } from "../motion";

const LINKS: [string, string][] = [
  ["01", "Work"],
  ["02", "Services"],
  ["03", "Studio"],
  ["04", "Insights"],
  ["05", "Start a project"],
];
const HREFS = ["/#work", "/#services", "/#studio", "/#insights", "/start"];

function Nav() {
  const phone = useMedia("(max-width: 767.98px)");
  const [open, setOpen] = useState(false);
  const [used, setUsed] = useState(false);
  const menu = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    menu.current?.focus();
  }, []);
  useFocusTrap(drawer, phone && open, close);
  useEffect(() => {
    if (phone && open) drawer.current?.querySelector<HTMLAnchorElement>("a")?.focus();
  }, [open, phone]);
  useEffect(() => {
    if (!phone) setOpen(false);
  }, [phone]);
  return (
    <nav aria-label="Main" class="main-nav">
      <span class="brand-mark">
        <span class="glow" aria-hidden="true" />
        Gloamwork
      </span>
      {phone && (
        <button type="button" class="menu-button" aria-expanded={open ? "true" : "false"} aria-controls="nav-drawer" ref={menu} onClick={() => {
          setUsed(true);
          if (open) close();
          else setOpen(true);
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
          Menu
        </button>
      )}
      <div class="nav-drawer" id="nav-drawer" ref={drawer} data-open={phone ? String(open) : "true"} data-animate={used ? "true" : "false"} inert={phone && !open}>
        <ul class="nav-links">
          {LINKS.map(([number, label], index) => (
            <li key={label}>
              <a href={HREFS[index]} onClick={() => setOpen(false)}>
                <span>{number}</span> {label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}

type Hit = { kind: "case_study" | "service" | "insight"; title: string; summary: string; url: string };
const GROUPS: [Hit["kind"], string][] = [
  ["case_study", "Case studies"],
  ["service", "Services"],
  ["insight", "Insights"],
];

function Search() {
  const [text, setText] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [status, setStatus] = useState("");
  const latest = useRef("");
  const timer = useRef<number | undefined>(undefined);
  const field = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const run = useCallback(async (query: string) => {
    window.clearTimeout(timer.current);
    if (!query.trim()) {
      setHits(null);
      return;
    }
    const reply = await api<{ query: string; hits: Hit[] }>("GET", `/api/search?q=${encodeURIComponent(query)}`);
    if (latest.current !== query) return;
    if (reply.ok) {
      setHits(reply.data.hits);
      setStatus(`Matches: ${reply.data.hits.length}`);
    } else {
      setHits([]);
      setStatus(reply.failure.message);
    }
  }, []);

  const onInput = (value: string): void => {
    setText(value);
    latest.current = value;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void run(value), 250);
  };

  const close = (): void => {
    setText("");
    latest.current = "";
    setHits(null);
    field.current?.focus();
  };

  return (
    <div class="studio-search" role="search" aria-label="Studio search">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void run(text);
        }}
      >
        <div class="search-field">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            ref={field}
            type="search"
            aria-label="Search the studio"
            placeholder="Search the studio"
            value={text}
            autocomplete="off"
            onInput={(e) => onInput(e.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                close();
              } else if (event.key === "ArrowDown") {
                const first = list.current?.querySelector<HTMLAnchorElement>("a");
                if (first) {
                  event.preventDefault();
                  first.focus();
                }
              }
            }}
          />
        </div>
      </form>
      <p class="sr-only" role="status" aria-label="Search status">
        {status}
      </p>
      {hits !== null && (
        <div class="search-panel" onKeyDown={(event) => event.key === "Escape" && close()}>
          {hits.length === 0 ? (
            <p>Nothing in the studio matches that search.</p>
          ) : (
            <ul aria-label="Search results" ref={list}>
              {GROUPS.filter(([kind]) => hits.some((hit) => hit.kind === kind)).map(([kind, heading]) => (
                <li key={kind}>
                  <h3>{heading}</h3>
                  <ul>
                    {hits
                      .filter((hit) => hit.kind === kind)
                      .map((hit) => (
                        <li key={hit.url + hit.title}>
                          <a href={hit.url} onClick={() => setHits(null)}>
                            {hit.title}
                            <small aria-hidden="true">{hit.summary}</small>
                          </a>
                        </li>
                      ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- outage banner ----------

type OutageService = "billing" | "storage" | "email" | "measuring" | "documents" | "content";
const COPY: Record<OutageService, string> = {
  billing: "Billing is offline right now. Nothing has been charged. Please try again in a few minutes.",
  storage: "File storage is offline right now. Your file was not saved. Please try again in a few minutes.",
  email: "Email is offline right now. Nothing has been charged. Please try again in a few minutes.",
  measuring: "Measuring is delayed. Your files are stored safely and will be measured when the queue is back.",
  documents: "Documents are offline right now. Payments still go through, and receipts and invoices will be emailed once documents are back.",
  content: "Studio content is offline right now. Please try again in a few minutes.",
};
const ORDER: OutageService[] = ["billing", "storage", "email", "measuring", "documents", "content"];
const CODES: Record<string, OutageService> = {
  billing_unavailable: "billing",
  storage_unavailable: "storage",
  email_unavailable: "email",
  content_unavailable: "content",
};

type OutageState = { down: Set<OutageService>; flagged: Set<OutageService> };
const outage: OutageState = { down: new Set(), flagged: new Set() };
const subscribers = new Set<() => void>();
const notify = (): void => subscribers.forEach((fn) => fn());

/** An action answered a service's 503: show its line until the service is seen up again. */
export function flagOutage(errorCode: string): void {
  const service = CODES[errorCode];
  if (!service || outage.flagged.has(service)) return;
  outage.flagged.add(service);
  notify();
}

/** A successful action proves its service is back. */
export function clearOutage(service: OutageService): void {
  if (outage.flagged.delete(service)) notify();
}

async function refreshStatus(): Promise<void> {
  const reply = await api<Record<string, "up" | "down">>("GET", "/api/status");
  if (!reply.ok) return;
  const down = new Set(ORDER.filter((s) => reply.data[s] === "down"));
  for (const s of ORDER) if (reply.data[s] === "up") outage.flagged.delete(s);
  outage.down = down;
  notify();
}

/** The page's `alert`: the published lines for the services this page shows, refreshed every 10 seconds in place. */
function OutageBanner({ services }: { services: OutageService[] }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const update = (): void => setTick((n) => n + 1);
    subscribers.add(update);
    void refreshStatus();
    const timer = window.setInterval(() => void refreshStatus(), 10_000);
    return () => {
      subscribers.delete(update);
      window.clearInterval(timer);
    };
  }, []);
  const lines = ORDER.filter((s) => (services.includes(s) || outage.flagged.has(s)) && (outage.down.has(s) || outage.flagged.has(s)));
  return (
    <div class="outage wrap" role="alert">
      {lines.map((service) => (
        <p key={service}>{COPY[service]}</p>
      ))}
    </div>
  );
}

export function Shell({ children, search = false, banner }: { children: ComponentChildren; search?: boolean; banner?: OutageService[] }) {
  return (
    <>
      <a class="skip-link" href="#main" onClick={(event) => {
        event.preventDefault();
        document.getElementById("main")?.focus();
      }}>
        Skip to content
      </a>
      <header class="site-header">
        <div class="wrap header-bar">
          <div class="header-tools">
            <Nav />
            {search && <Search />}
          </div>
        </div>
      </header>
      {banner && <OutageBanner services={banner} />}
      <main id="main" tabindex={-1}>
        {children}
      </main>
      <footer class="wrap site-footer">
        <strong>Gloamwork</strong>
        <span>A one-person CGI studio. Renders from your own CAD.</span>
        <a href="/">Back to the studio</a>
      </footer>
    </>
  );
}
