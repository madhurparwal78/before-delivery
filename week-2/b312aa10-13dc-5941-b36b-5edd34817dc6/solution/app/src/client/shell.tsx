// The shared frame: header with navigation and hour bank, the service banner, the live regions,
// and the screen for the address.

import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { del, get, onOwnAction, whenUnauthenticated } from "./api.js";
import { navigate, returnTarget, signInAddress, useAddress } from "./router.js";
import { alertText, announcement, bank, context, endBrowserSession, setBank, showError, useStore, reducedMotion } from "./store.js";
import { Button, Icon } from "./ui.js";
import type { HourBank, KitchenInfo, ServiceStatus, SessionInfo } from "./types.js";
import { hoursText, quartersOf } from "../shared/format.js";
import { monthName } from "../shared/time.js";
import type { Role } from "../shared/rules.js";
import { ROLE_REFUSED_COPY } from "../shared/copy.js";
import { SignIn } from "./pages/signin.js";
import { BoardScreen } from "./pages/board.js";
import { BookingsScreen } from "./pages/bookings.js";
import { DocumentsScreen } from "./pages/documents.js";
import { InvoicesScreen } from "./pages/invoices.js";
import { ReportsScreen } from "./pages/reports.js";
import { SanitationScreen } from "./pages/sanitation.js";
import { SettingsScreen } from "./pages/settings.js";
import { InspectScreen } from "./pages/inspect.js";

// Any screen that receives a 401 ends the browser's session and returns to sign in (with its address as `next`).
whenUnauthenticated(() => {
  if (context.get()) endBrowserSession();
});

const NAV: Array<{ path: string; label: string; roles: Role[] }> = [
  { path: "/board", label: "Line board", roles: ["member", "shift_lead", "operator"] },
  { path: "/bookings", label: "Bookings", roles: ["member", "operator"] },
  { path: "/documents", label: "Documents", roles: ["member", "shift_lead", "operator"] },
  { path: "/invoices", label: "Invoices", roles: ["member", "operator"] },
  { path: "/reports", label: "Reports", roles: ["operator"] },
  { path: "/sanitation", label: "Sanitation", roles: ["shift_lead", "operator"] },
  { path: "/settings", label: "Settings", roles: ["operator"] },
];


const PHONE = "(max-width: 767px)";

/** True in the phone layout (narrower than 768 pixels). */
function usePhone(): boolean {
  const [phone, setPhone] = useState(() => matchMedia(PHONE).matches);
  useEffect(() => {
    const query = matchMedia(PHONE);
    const update = (): void => setPhone(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return phone;
}

export function LiveRegions() {
  const said = useStore(announcement);
  const error = useStore(alertText);
  return (
    <div class="live">
      <div role="status" aria-live="polite" aria-label="Announcements" class="live-status">
        {said.text && <p key={said.n}>{said.text}</p>}
      </div>
      <div role="alert" class="live-alert">
        {error.text && <p key={error.n}>{error.text}</p>}
      </div>
    </div>
  );
}

/** The member's hour bank for the month on screen; screens set the month, the board also rolls it. */
export function useBankMonth(month: string | null): void {
  const ctx = useStore(context);
  const memberId = ctx?.session.user.memberId;
  useEffect(() => {
    if (!memberId || !month) return;
    get<HourBank>(`/api/members/${memberId}/hour-bank?month=${month}`).then(
      ({ data }) => setBank(data.month, quartersOf(data.balanceHours)),
      () => undefined,
    );
  }, [memberId, month]);
}

function HourBankFigure() {
  const value = useStore(bank);
  const figure = useRef<HTMLSpanElement>(null);
  const last = useRef(value.rolls);
  useLayoutEffect(() => {
    if (value.rolls !== last.current && figure.current && !reducedMotion()) {
      figure.current.animate([{ transform: "translateY(-0.4em)", opacity: 0.2 }, { transform: "none", opacity: 1 }], { duration: 180, easing: "cubic-bezier(0.16, 1, 0.3, 1)" });
    }
    last.current = value.rolls;
  }, [value.rolls]);
  if (value.quarters === null || value.month === null) return <div role="group" aria-label="Hour bank" class="bank" />;
  return (
    <div role="group" aria-label="Hour bank" class="bank">
      <span class="bank-line"><span class="bank-figure" ref={figure}>{hoursText(value.quarters)}</span> h left</span>
      <span class="bank-month">{monthName(value.month)}</span>
    </div>
  );
}

function ServiceBanner() {
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const [shown, setShown] = useState<ServiceStatus | null>(null);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    // The latest read sent wins, so a slow poll never puts back older counts.
    let sent = 0;
    let drawn = 0;
    const load = (): void => {
      const mine = ++sent;
      get<ServiceStatus>("/api/service-status").then(({ data }) => {
        if (mine < drawn) return;
        drawn = mine;
        setStatus(data);
      }, () => undefined);
    };
    load();
    const timer = setInterval(load, 5000);
    // Feedback states › Service banner: re-read at once after each of the person's own actions
    // answers, so the waiting counts update within a second. Only the text inside the region changes.
    const stop = onOwnAction(load);
    return () => {
      clearInterval(timer);
      stop();
    };
  }, []);
  const down = status && (status.billing === "down" || status.storage === "down");
  useEffect(() => {
    if (down) setShown(status);
    else if (shown && ref.current && !reducedMotion()) {
      ref.current.animate([{ transform: "none" }, { transform: "translateY(-100%)" }], { duration: 180, easing: "cubic-bezier(0.16, 1, 0.3, 1)", fill: "forwards" })
        .finished.then(() => setShown(null), () => setShown(null));
    } else setShown(null);
  }, [status]);
  if (!shown) return null;
  return (
    <section ref={ref} class="banner" role="region" aria-label="Service status">
      {shown.billing === "down" && <p>Billing is unavailable. Confirmed bookings are saved and marked Pending billing; charges are recorded automatically when billing returns.</p>}
      {shown.storage === "down" && <p>Document storage is unavailable. Uploads and downloads are paused; monthly sanitation PDFs are queued.</p>}
      <p class="banner-count"><span class="figure">{shown.queued.billing}</span> billing items waiting · <span class="figure">{shown.queued.storage}</span> storage items waiting</p>
    </section>
  );
}

/**
 * The header. In the phone layout Menu discloses one panel holding the navigation and Sign out;
 * folded, the panel is `hidden` and `inert`, so neither is in the accessibility tree, the Tab order
 * or reach of a pointer. Only the person's own actions (Menu, Escape, a tap outside, a link, Back
 * and Forward, a change of layout) fold or open it; refreshes and alerts never touch it.
 */
function Header({ session, kitchen }: { session: SessionInfo; kitchen: KitchenInfo }) {
  const address = useAddress();
  const phone = usePhone();
  const [open, setOpen] = useState(false);
  const menuButton = (): HTMLElement | null => document.querySelector<HTMLElement>(".header .menu-button");
  const panel = useRef<HTMLDivElement>(null);
  const focusFirst = useRef(false);
  const folded = phone && !open;

  // Sign-out ends the browser's session at once (nothing of it is drawn again), then ends it on the server.
  const signOut = async (): Promise<void> => {
    endBrowserSession();
    navigate("/");
    await del("/api/session").catch(() => undefined);
  };
  const fold = (toMenu: boolean): void => {
    setOpen(false);
    if (toMenu) menuButton()?.focus();
  };

  // Widening or narrowing always leaves the panel folded; so do Back and Forward.
  useEffect(() => setOpen(false), [phone]);
  useEffect(() => {
    const onPop = (): void => setOpen(false);
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => {
    if (!open || !focusFirst.current) return;
    focusFirst.current = false;
    panel.current?.querySelector<HTMLElement>("nav a")?.focus();
  }, [open]);
  useEffect(() => {
    if (!phone || !open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      fold(true);
    };
    const onClick = (e: MouseEvent): void => {
      const target = e.target as Node;
      if (panel.current?.contains(target) || menuButton()?.contains(target)) return;
      fold(true);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClick, true);
    };
  }, [phone, open]);

  const items = NAV.filter((n) => n.roles.includes(session.user.role));
  return (
    <header class="header">
      <p class="kitchen-name">{kitchen.name}</p>
      {phone && (
        <Button class="menu-button" aria-expanded={open ? "true" : "false"} aria-controls="main-menu"
          onClick={() => {
            if (open) fold(false);
            else {
              focusFirst.current = true;
              setOpen(true);
            }
          }}>
          <Icon name={open ? "x" : "menu"} />Menu
        </Button>
      )}
      {session.user.role === "member" && <HourBankFigure />}
      <div id="main-menu" ref={panel} class="menu-panel" hidden={folded} inert={folded || undefined}>
        <nav id="main-nav" aria-label="Main" class="nav">
          <ul>
            {items.map((n) => (
              <li>
                <a
                  href={n.path}
                  aria-current={address.path === n.path ? "page" : undefined}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
                    e.preventDefault();
                    navigate(n.path);
                    if (phone) {
                      // The chosen screen loads into the main landmark, which keeps focus as the panel folds.
                      document.getElementById("main")?.focus();
                      setOpen(false);
                    }
                  }}
                >
                  {n.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div class="who">
          <span class="who-name">{session.user.name}</span>
          <Button class="btn-quiet" onClick={() => void signOut()}>Sign out</Button>
        </div>
      </div>
    </header>
  );
}

/** Screens without a month of their own show the hour bank for the kitchen-local current month. */
function CurrentMonthBank() {
  useBankMonth(useStore(context)?.kitchen.currentMonth ?? null);
  return null;
}

function Screen({ path, role }: { path: string; role: Role }) {
  const entry = NAV.find((n) => n.path === path);
  useEffect(() => {
    if (entry && entry.roles.includes(role)) return;
    // Replacing the entry keeps Back from returning to the refused address.
    navigate("/board", true);
    if (entry) showError(ROLE_REFUSED_COPY);
  }, [path, role]);
  if (!entry || !entry.roles.includes(role)) return null;
  switch (path) {
    case "/bookings": return <BookingsScreen />;
    case "/documents": return <DocumentsScreen />;
    case "/invoices": return <InvoicesScreen />;
    case "/reports": return <><CurrentMonthBank /><ReportsScreen /></>;
    case "/sanitation": return <><CurrentMonthBank /><SanitationScreen /></>;
    case "/settings": return <><CurrentMonthBank /><SettingsScreen /></>;
    default: return <BoardScreen />;
  }
}

export function App() {
  const address = useAddress();
  const ctx = useStore(context);
  const inspect = address.path.startsWith("/inspect/");

  useEffect(() => {
    if (inspect) return;
    if (ctx && address.path === "/") navigate(returnTarget(location.search), true);
    if (!ctx && address.path !== "/") navigate(signInAddress(address.path, location.search), true);
  }, [ctx, address.path]);

  if (inspect) return <InspectScreen token={decodeURIComponent(address.path.slice("/inspect/".length))} />;
  if (!ctx || address.path === "/") {
    return (
      <>
        <LiveRegions />
        {!ctx && <SignIn />}
      </>
    );
  }
  return (
    <div class="frame">
      <Header session={ctx.session} kitchen={ctx.kitchen} />
      <ServiceBanner />
      <LiveRegions />
      <main class="main" id="main" tabIndex={-1}>
        <Screen key={address.path} path={address.path} role={ctx.session.user.role} />
      </main>
    </div>
  );
}
