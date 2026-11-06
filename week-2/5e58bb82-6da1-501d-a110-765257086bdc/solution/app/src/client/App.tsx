// Boot, routing and the signed-in shell (top bar, service banners, idle sign-out).
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { api, quietly, whenSessionEnds, type Units, type User } from "./api";
import { IdleGuard } from "./components/IdleGuard";
import { usePoll } from "./hooks";
import { follow, navigate, useLocation } from "./router";
import { onStatus, refreshStatus } from "./services";
import { dropBrowserState, HOMES, revoke, SessionContext, type Session } from "./session";
import { Console } from "./screens/Console";
import { Flags } from "./screens/Flags";
import { Fleet } from "./screens/Fleet";
import { History } from "./screens/History";
import { Launch } from "./screens/Launch";
import { LinePlan } from "./screens/LinePlan";
import { Missions } from "./screens/Missions";
import { NewMission } from "./screens/NewMission";
import { NotFound } from "./screens/NotFound";
import { SignIn } from "./screens/SignIn";
import { Survey } from "./screens/Survey";
import { Surveys } from "./screens/Surveys";

const STAFF = new Set(["principal_surveyor", "launch_technician"]);

/** Which screen an address shows for a role; null is the not-found page. */
function screenFor(path: string, user: User): (() => ReactNode) | null {
  const staff = STAFF.has(user.role);
  const parts = path.split("/").filter(Boolean);
  const [first, id, tail] = parts;
  if (staff && path === "/fleet") return () => <Fleet vesselId={null} />;
  if (staff && first === "fleet" && parts.length === 2) return () => <Fleet vesselId={id} key="fleet" />;
  if (staff && path === "/missions") return () => <Missions />;
  if (path === "/missions/new") return user.role === "principal_surveyor" ? () => <NewMission /> : null;
  if (staff && first === "missions" && parts.length === 2) return () => <Console missionId={id} key={id} />;
  if (staff && first === "missions" && parts.length === 3 && tail === "plan") return () => <LinePlan missionId={id} key={id} />;
  if (staff && first === "missions" && parts.length === 3 && tail === "history") return () => <History missionId={id} key={id} />;
  if (staff && path === "/launch") return () => <Launch />;
  if (staff && path === "/flags") return () => <Flags />;
  if (user.role === "client_reviewer" && path === "/surveys") return () => <Surveys />;
  if (user.role === "client_reviewer" && first === "surveys" && parts.length === 2) return () => <Survey missionId={id} key={id} />;
  return null;
}

const NAV: Record<User["role"], [string, string][]> = {
  principal_surveyor: [["Fleet", "/fleet"], ["Missions", "/missions"], ["New mission", "/missions/new"]],
  launch_technician: [["Fleet", "/fleet"], ["Missions", "/missions"], ["Launch list", "/launch"]],
  client_reviewer: [["Surveys", "/surveys"]],
};

const MARK = (
  <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
    <path d="M4 22h24M4 16h24M4 10h24" stroke="#c9c0ae" strokeWidth="1" />
    <path d="M9 6v20M16 6v20M23 6v20" stroke="#1e4d78" strokeWidth="2" />
    <path d="M16 13l-3 6h6z" fill="#1b1a17" />
  </svg>
);

const STORAGE_DOWN = "Line-file storage is unreachable — uploads are paused and will resume on their own.";
const STORAGE_BACK = "Line-file storage is back";
const MAIL_DOWN = "Alert email is delayed — alerts still show on this board.";

/** The Service status banner: written on changes only, never rewritten by polling. */
function useServiceBanner(staff: boolean): string[] {
  const [storageLine, setStorageLine] = useState<string | null>(null);
  const [mailLine, setMailLine] = useState<string | null>(null);
  const backTimer = useRef(0);
  useEffect(() => onStatus((next, previous) => {
    if (!previous || previous.storage !== next.storage) {
      window.clearTimeout(backTimer.current);
      if (next.storage === "down") setStorageLine(STORAGE_DOWN);
      else if (previous?.storage === "down") {
        setStorageLine(STORAGE_BACK);
        backTimer.current = window.setTimeout(() => setStorageLine(null), 10_000);
      }
    } else if (storageLine === STORAGE_BACK) {
      window.clearTimeout(backTimer.current);
      setStorageLine(null);
    }
    setMailLine(staff && next.mail === "down" ? MAIL_DOWN : null);
  }), [staff, storageLine]);
  return [storageLine, mailLine].filter((l): l is string => !!l);
}

function Shell({ session, children }: { session: Session; children: ReactNode }) {
  const { user } = session;
  const { path } = useLocation();
  const [sessionStatus, setSessionStatus] = useState("");
  usePoll(refreshStatus, 4000, [user.id]);
  const banner = useServiceBanner(user.role !== "client_reviewer");
  const expire = useCallback(() => session.signOut({ next: window.location.pathname + window.location.search, idle: true }), [session]);
  return (
    <>
      <header className="topbar">
        <span className="brand">{MARK}Swathdeck</span>
        <nav aria-label="Main">
          <ul>
            {NAV[user.role].map(([label, href]) => (
              <li key={href}>
                <a href={href} aria-current={path === href ? "page" : undefined} onClick={(e) => {
                  e.preventDefault();
                  follow(href);
                }}>{label}</a>
              </li>
            ))}
          </ul>
        </nav>
        <fieldset className="units" role="radiogroup" aria-label="Units">
          {(["metric", "imperial"] as Units[]).map((u) => (
            <label key={u}>
              <input type="radio" name="units" value={u} checked={user.units === u} onChange={() => session.setUnits(u)} />
              {u === "metric" ? "Metric" : "Imperial"}
            </label>
          ))}
        </fieldset>
        <button type="button" onClick={() => session.signOut()}>Sign out</button>
        <div className="service-status" role="status" aria-live="polite" aria-label="Service status">
          {banner.map((line) => <p key={line}>{line}</p>)}
        </div>
        <div className="sr-only" role="status" aria-live="polite" aria-label="Session status">{sessionStatus}</div>
      </header>
      {children}
      <IdleGuard onExpire={expire} setStatus={setSessionStatus} />
    </>
  );
}

export function App() {
  const location = useLocation();
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    quietly(api<User>("/api/me", { own401: true }).then((r) => setUser(r.ok ? r.data : null)));
  }, []);

  const signOut = useCallback((after: { next?: string; idle?: boolean } = {}) => {
    revoke();
    dropBrowserState();
    const href = after.next ? `/sign-in?next=${encodeURIComponent(after.next)}` : "/sign-in";
    // The user and the address change in one committed step, so no screen renders between them.
    flushSync(() => {
      setUser(null);
      navigate(href, { state: after.idle ? { idle: true } : null });
    });
  }, []);

  useEffect(() => whenSessionEnds(() => {
    dropBrowserState();
    const here = window.location.pathname + window.location.search;
    flushSync(() => {
      setUser(null);
      navigate(window.location.pathname === "/sign-in" ? here : `/sign-in?next=${encodeURIComponent(here)}`, { replace: true });
    });
  }), []);

  const session = useMemo<Session | null>(() => user ? {
    user,
    setUnits: (units) => {
      setUser({ ...user, units });
      quietly(api<User>("/api/me", { method: "PATCH", body: { units } }).then((r) => r.ok && setUser(r.data)));
    },
    signOut,
    switchTo: (next, home) => {
      dropBrowserState();
      flushSync(() => {
        setUser(next);
        navigate(home, { replace: true });
      });
    },
  } : null, [user, signOut]);

  // Signed out: any screen address goes to sign-in with the address as `next`.
  useEffect(() => {
    if (user === null && location.path !== "/sign-in") {
      navigate(`/sign-in?next=${encodeURIComponent(location.href)}`, { replace: true });
    }
  }, [user, location.path, location.href]);

  // A signed-in user on the sign-in page goes where the server's safe-return rule sends `next`.
  useEffect(() => {
    if (!user || location.path !== "/sign-in") return;
    const next = new URLSearchParams(location.search).get("next");
    if (next === null) {
      navigate(HOMES[user.role], { replace: true });
      return;
    }
    quietly(api("/api/me/last-screen", { method: "PUT", body: { path: next } })
      .then((r) => navigate(r.ok ? next : HOMES[user.role], { replace: true })));
  }, [user, location.path, location.search]);

  const screen = user ? screenFor(location.path, user) : null;

  // Every screen address (not sign-in, not the not-found page) is recorded as the last screen.
  useEffect(() => {
    if (user && screen) quietly(api("/api/me/last-screen", { method: "PUT", body: { path: location.href } }));
  }, [user, location.href, screen === null]);

  // A page restored from the back-forward cache must not show a previous account's screen.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        document.body.textContent = "";
        window.location.reload();
      }
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  if (user === undefined) return <main className="page"><p className="muted">Loading Swathdeck…</p></main>;
  if (!user || !session) {
    return location.path === "/sign-in"
      ? <SignIn onSignedIn={(u, home) => {
        flushSync(() => {
          setUser(u);
          navigate(home, { replace: true });
        });
      }} />
      : <main className="page"><p className="muted">Loading Swathdeck…</p></main>;
  }
  if (location.path === "/sign-in") return <main className="page"><p className="muted">Loading Swathdeck…</p></main>;
  return (
    <SessionContext.Provider value={session}>
      <Shell session={session}>{screen ? screen() : <NotFound />}</Shell>
    </SessionContext.Provider>
  );
}
