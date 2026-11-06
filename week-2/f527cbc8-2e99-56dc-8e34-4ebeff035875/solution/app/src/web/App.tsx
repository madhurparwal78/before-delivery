// The app: sign-in, the shell (header, Notices, rail of barn days) and the screen for each URL
// (brief: Screens and layout; Interactions, URLs and history; Rail and refresh).
import { type FormEvent, type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type BarnDay, type Practice, type User, get, request, whenSignedOut } from "./api";
import { DashboardScreen } from "./dashboard";
import { DayScreen, NewBarnDay } from "./days";
import { HorsePanel } from "./horse";
import { SequenceProvider } from "./motion";
import { HorsesScreen, InvoicesScreen, PricesScreen } from "./records";
import { type Route, dayPath, navigate, useRoute } from "./router";
import { SessionContext } from "./session";
import { ROLE_LABELS, dollars } from "./format";
import {
  AppLink,
  Button,
  Empty,
  NETWORK_COPY,
  type Notice,
  AnnounceContext,
  NoticesContext,
  useAnnounce,
  NoticesRegion,
  RefreshContext,
  type Tone,
  useNotify,
  useRefresh,
} from "./ui";
import { VetPage } from "./vet";

const RAIL_REFRESH_MS = 30_000;
const PENDING_REFRESH_MS = 10_000;
/** How long an action's own message stays in Notices before a background announcement may replace it. */
const ACTION_NOTICE_MS = 10_000;

export function App() {
  const route = useRoute();
  const [notice, setNotice] = useState<Notice | null>(null);
  const serial = useRef(0);
  // An action's message is the one that replaces its pending copy; other notices carry no user action.
  const actionPending = useRef(false);
  const actionAt = useRef(Number.NEGATIVE_INFINITY);
  const notify = useCallback((text: string, tone: Tone) => {
    serial.current += 1;
    if (tone === "pending" || actionPending.current) actionAt.current = performance.now();
    actionPending.current = tone === "pending";
    setNotice({ text, tone, serial: serial.current });
  }, []);
  // A refresh never replaces a message the last action just put in Notices (brief: Rail and refresh): an
  // announcement with no user action behind it joins that message instead.
  const announce = useCallback(
    (text: string, background: boolean) => {
      if (!background) return notify(text, "success");
      serial.current += 1;
      const fresh = performance.now() - actionAt.current < ACTION_NOTICE_MS;
      setNotice((current) =>
        fresh && current && current.tone !== "pending"
          ? { text: `${current.text} ${text}`, tone: current.tone, serial: serial.current }
          : { text, tone: "success", serial: serial.current },
      );
    },
    [notify],
  );
  const background = useCallback((text: string) => announce(text, true), [announce]);
  if (route.kind === "vet") return <VetPage token={route.token} />;
  return (
    <NoticesContext.Provider value={notify}>
      <AnnounceContext.Provider value={background}>
        <SequenceProvider notify={announce}>
          <Signed route={route} notice={notice} />
        </SequenceProvider>
      </AnnounceContext.Provider>
    </NoticesContext.Provider>
  );
}

const here = (): string => `${window.location.pathname}${window.location.search}`;
const signInPath = (next: string): string => (next === "/" ? "/sign-in" : `/sign-in?next=${encodeURIComponent(next)}`);

/** Resolves the session, then shows the sign-in form or the shell. */
function Signed({ route, notice }: { route: Route; notice: Notice | null }) {
  const [session, setSession] = useState<{ user: User; practice: Practice } | null | undefined>(undefined);

  const load = useCallback(async () => {
    const me = await get<User>("/api/me");
    if (!me.ok) {
      setSession(me.status === 401 ? null : undefined);
      return;
    }
    const practice = await get<Practice>("/api/practice");
    if (practice.ok) setSession({ user: me.data, practice: practice.data });
  }, []);

  useEffect(() => {
    whenSignedOut(() => {
      setSession(null);
      if (window.location.pathname !== "/sign-in") navigate(signInPath(here()), true);
    });
    void load();
  }, [load]);

  useEffect(() => {
    if (session === null && route.kind !== "sign-in") navigate(signInPath(here()), true);
    if (session && route.kind === "sign-in") navigate(route.next, true);
  }, [session, route]);

  if (session === undefined) return <div className="boot" aria-busy="true" />;
  if (session === null || route.kind === "sign-in") {
    return (
      <SignIn
        notice={notice}
        next={route.kind === "sign-in" ? route.next : "/"}
        onSignedIn={(user, practice) => setSession({ user, practice })}
      />
    );
  }
  return (
    <SessionContext.Provider value={session}>
      <Shell route={route} notice={notice} user={session.user} onSignedOut={() => setSession(null)} />
    </SessionContext.Provider>
  );
}

function Wordmark() {
  return (
    <span className="wordmark">
      <svg viewBox="0 0 40 40" width="32" height="32" aria-hidden="true" focusable="false">
        <path d="M11 34V19a9 9 0 0 1 18 0v15" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="square" />
        <path d="M11 34h5M24 34h5" stroke="var(--forge)" strokeWidth="5" />
        <path d="M6 8l28 0" stroke="currentColor" strokeWidth="2.5" strokeDasharray="2 2" />
      </svg>
      <span className="wordmark-text">
        Rasp &amp; Rein <span className="wordmark-product">Clinchline</span>
      </span>
    </span>
  );
}

function SignIn({
  notice,
  next,
  onSignedIn,
}: {
  notice: Notice | null;
  next: string;
  onSignedIn: (user: User, practice: Practice) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage("Signing in…");
    const result = await request<{ user: User }>("POST", "/api/session", { body: { email, password } });
    if (!result.ok) {
      setBusy(false);
      setMessage(result.status === 0 ? NETWORK_COPY : result.status === 401 ? "Email or password is wrong." : "Enter your email and password.");
      return;
    }
    const practice = await get<Practice>("/api/practice");
    setBusy(false);
    if (!practice.ok) {
      setMessage(NETWORK_COPY);
      return;
    }
    navigate(next, true);
    onSignedIn(result.data.user, practice.data);
  }

  const failed = message !== null && message !== "Signing in…";
  return (
    <div className="sign-in-page">
      <main className="sign-in-card">
        <Wordmark />
        <h1>Sign in</h1>
        <form aria-label="Sign in" onSubmit={(event) => void submit(event)} noValidate>
          <div className="field">
            <label htmlFor="sign-in-email">Email</label>
            <input id="sign-in-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="sign-in-password">Password</label>
            <input
              id="sign-in-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <Button type="submit" variant="primary" busy={busy}>
            Sign in
          </Button>
        </form>
        <div className="notices-tone" data-tone={failed ? "error" : "idle"}>
          {failed ? <span className="prefix">Error:</span> : null}
          <div className="notices" role="status" aria-live="polite" aria-label="Notices" data-tone={failed ? "error" : "idle"}>
            {message ? <p>{message}</p> : notice ? <p>{notice.text}</p> : null}
          </div>
        </div>
      </main>
    </div>
  );
}

function Shell({ route, notice, user, onSignedOut }: { route: Route; notice: Notice | null; user: User; onSignedOut: () => void }) {
  const [tick, setTick] = useState(0);
  const [pendingScreens, setPendingScreens] = useState<ReadonlySet<string>>(new Set());
  const refresh = useCallback(() => setTick((value) => value + 1), []);
  const setPending = useCallback((screen: string, pending: boolean) => {
    setPendingScreens((current) => {
      if (current.has(screen) === pending) return current;
      const next = new Set(current);
      if (pending) next.add(screen);
      else next.delete(screen);
      return next;
    });
  }, []);
  const interval = pendingScreens.size ? PENDING_REFRESH_MS : RAIL_REFRESH_MS;
  useEffect(() => {
    const timer = window.setTimeout(refresh, interval);
    return () => window.clearTimeout(timer);
  }, [tick, interval, refresh]);
  const value = useMemo(() => ({ tick, refresh, setPending }), [tick, refresh, setPending]);

  return (
    <RefreshContext.Provider value={value}>
      <ShellLayout route={route} notice={notice} user={user} onSignedOut={onSignedOut} />
    </RefreshContext.Provider>
  );
}

const ALERT_SEEN = "clinchline.outstanding-alert";

/**
 * The farrier's outstanding-balance alert: each new alert is announced once in Notices on the next refresh
 * (brief: Feedback states, Outstanding alert).
 */
function useOutstandingAlert(enabled: boolean, tick: number): void {
  const announce = useAnnounce();
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void get<Practice>("/api/practice").then((result) => {
      const alert = result.ok ? result.data.outstanding_alert : null;
      if (!live || !alert) return;
      const seen = Number(window.localStorage.getItem(ALERT_SEEN) ?? "0");
      if (alert.id <= seen) return;
      window.localStorage.setItem(ALERT_SEEN, String(alert.id));
      announce(`Outstanding balance over ${dollars(alert.threshold_cents)}`);
    });
    return () => {
      live = false;
    };
  }, [enabled, tick, announce]);
}

/**
 * A table box that is wider than its column scrolls sideways on its own; while it does, it is a named, focusable
 * region so the keyboard can scroll it too.
 */
function useScrollRegions(root: HTMLElement | null): void {
  useEffect(() => {
    if (!root) return;
    const update = (): void => {
      for (const box of root.querySelectorAll<HTMLElement>(".table-scroll")) {
        const scrolls = box.scrollWidth > box.clientWidth + 1;
        if (scrolls && box.tabIndex !== 0) {
          box.tabIndex = 0;
          box.setAttribute("role", "region");
          box.setAttribute("aria-label", `${box.querySelector("table")?.getAttribute("aria-label") ?? "Table"}, scrolls sideways`);
        } else if (!scrolls && box.hasAttribute("tabindex")) {
          box.removeAttribute("tabindex");
          box.removeAttribute("role");
          box.removeAttribute("aria-label");
        }
      }
    };
    const resize = new ResizeObserver(update);
    resize.observe(root);
    const mutation = new MutationObserver(update);
    mutation.observe(root, { childList: true, subtree: true });
    update();
    return () => {
      resize.disconnect();
      mutation.disconnect();
    };
  }, [root]);
}

function ShellLayout({ route, notice, user, onSignedOut }: { route: Route; notice: Notice | null; user: User; onSignedOut: () => void }) {
  const { tick, refresh } = useRefresh();
  const [mainElement, mainRef] = useState<HTMLElement | null>(null);
  useScrollRegions(mainElement);
  useOutstandingAlert(user.role === "farrier", tick);
  const [days, setDays] = useState<BarnDay[] | null>(null);
  const [railOpen, setRailOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [newDayOpen, setNewDayOpen] = useState(false);

  useEffect(() => {
    let live = true;
    void get<BarnDay[]>("/api/barn-days").then((result) => {
      if (live && result.ok)
        setDays([...result.data].sort((a, b) => (a.business_date + a.start_time).localeCompare(b.business_date + b.start_time)));
    });
    return () => {
      live = false;
    };
  }, [tick]);

  useEffect(() => {
    setRailOpen(false);
  }, [route]);

  const homeDay = route.kind === "home" ? days?.[0] : undefined;
  const currentDayId = route.kind === "day" ? route.id : homeDay?.id;

  async function signOut(): Promise<void> {
    setSigningOut(true);
    await request("DELETE", "/api/session");
    navigate("/sign-in", true);
    onSignedOut();
  }

  const sections =
    user.role === "farrier"
      ? [
          ["/horses", "Horses"],
          ["/invoices", "Invoices"],
          ["/prices", "Prices"],
          ["/dashboard", "Dashboard"],
        ]
      : user.role === "owner"
        ? [
            ["/horses", "Horses"],
            ["/invoices", "Invoices"],
          ]
        : [];
  const sectionActive = (path: string): boolean =>
    (path === "/horses" && (route.kind === "horses" || route.kind === "horse")) ||
    (path === "/invoices" && route.kind === "invoices") ||
    (path === "/prices" && route.kind === "prices") ||
    (path === "/dashboard" && route.kind === "dashboard");

  return (
    <div className="shell">
      <header className="topbar">
        <AppLink href="/" className="brand" aria-label="Rasp & Rein Clinchline, home">
          <Wordmark />
        </AppLink>
        <Button className="rail-toggle" aria-expanded={railOpen} aria-controls="rail" onClick={() => setRailOpen((open) => !open)}>
          Barn days
        </Button>
        {user.role === "farrier" ? (
          <Button variant="primary" className="new-day" data-focus="new-barn-day" onClick={() => setNewDayOpen(true)}>
            New barn day
          </Button>
        ) : null}
        <div className="who">
          <span className="who-name">{user.name}</span>
          <span className="who-role">{ROLE_LABELS[user.role]}</span>
        </div>
        <Button variant="quiet" busy={signingOut} onClick={() => void signOut()}>
          Sign out
        </Button>
      </header>
      <NoticesRegion notice={notice} />
      <div className="frame">
        <aside id="rail" className="rail" data-open={railOpen ? "true" : "false"}>
          <nav aria-label="Barn days">
            <h2 className="rail-heading">Barn days</h2>
            {days === null ? (
              <p className="rail-empty">Loading barn days…</p>
            ) : days.length === 0 ? (
              <p className="rail-empty">No barn days yet.</p>
            ) : (
              <RailDays days={days} currentDayId={currentDayId} />
            )}
          </nav>
          {sections.length ? (
            <nav aria-label="Records" className="rail-sections">
              <ul>
                {sections.map(([path, name]) => (
                  <li key={path}>
                    <AppLink href={path ?? "/"} className="rail-section" aria-current={sectionActive(path ?? "") ? "page" : undefined}>
                      {name}
                    </AppLink>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
        </aside>
        <main className="main" id="main" tabIndex={0} ref={mainRef}>
          <Screen route={route} homeDay={homeDay} daysLoaded={days !== null} />
        </main>
      </div>
      {user.role === "farrier" ? (
        <NewBarnDay
          open={newDayOpen}
          onClose={(saved) => {
            setNewDayOpen(false);
            if (saved) refresh();
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * The rail's barn days as one Tab stop: the day on screen (or the first) takes Tab, and the arrow keys, Home and
 * End move between days, so a long season of days never stands between the keyboard and the main column.
 */
function RailDays({ days, currentDayId }: { days: BarnDay[]; currentDayId: string | undefined }) {
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const list = useRef<HTMLOListElement>(null);
  const currentIndex = Math.max(0, days.findIndex((day) => day.id === currentDayId));
  const stop = focusIndex !== null && focusIndex < days.length ? focusIndex : currentIndex;
  // The day on screen is brought into view inside the rail's own scroll box.
  useEffect(() => {
    list.current?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({ block: "nearest" });
  }, [currentDayId]);
  function move(event: KeyboardEvent<HTMLOListElement>): void {
    const keys: Record<string, (index: number) => number> = {
      ArrowDown: (index) => Math.min(days.length - 1, index + 1),
      ArrowUp: (index) => Math.max(0, index - 1),
      Home: () => 0,
      End: () => days.length - 1,
    };
    const step = keys[event.key];
    if (!step) return;
    event.preventDefault();
    const next = step(stop);
    setFocusIndex(next);
    list.current?.querySelectorAll<HTMLElement>("a")[next]?.focus();
  }
  return (
    <ol className="rail-days" ref={list} onKeyDown={move}>
      {days.map((day, index) => {
        // The visible text is the accessible name: "<date> <barn> <booked>/<slots>".
        return (
          <li key={day.id}>
            <AppLink
              href={dayPath(day.id)}
              aria-current={day.id === currentDayId ? "page" : undefined}
              className="rail-day"
              data-status={day.status}
              tabIndex={index === stop ? 0 : -1}
              onFocus={() => setFocusIndex(index)}
            >
              <span className="rail-date num">{day.business_date}</span>{" "}
              <span className="rail-barn">
                {day.barn.name}
                {/* Decorative: aria-hidden keeps the marker out of the accessible name. */}
                {day.status === "draft" && <span className="rail-draft" aria-hidden="true"> · draft</span>}
              </span>{" "}
              <span className="rail-count num">
                {day.booked_count}/{day.slot_count}
              </span>
            </AppLink>
          </li>
        );
      })}
    </ol>
  );
}

function Screen({ route, homeDay, daysLoaded }: { route: Route; homeDay: BarnDay | undefined; daysLoaded: boolean }) {
  switch (route.kind) {
    case "day":
      return <DayScreen key={route.id} id={route.id} />;
    case "horse":
      return <HorsePanel key={route.id} id={route.id} hoof={route.hoof} />;
    case "horses":
      return <HorsesScreen />;
    case "invoices":
      return <InvoicesScreen />;
    case "prices":
      return <PricesScreen />;
    case "dashboard":
      return <DashboardScreen />;
    default:
      if (homeDay) return <DayScreen key={homeDay.id} id={homeDay.id} />;
      return daysLoaded ? <Empty>No barn days yet.</Empty> : null;
  }
}
