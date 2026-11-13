import type { ComponentChildren } from "preact";
import { createContext } from "preact";
import { useContext, useEffect, useState } from "preact/hooks";
import { type Result, type Role, type User, del, get } from "./api";
import { Icon } from "./icons";

// The shell every screen shares: skip link, sticky band, primary navigation and the two live regions
// (brief: Screens and layout; Public screens and controls; Feedback states).

interface Band {
  name: string;
  target: string | null;
  fallback?: string;
}

interface DeskState {
  /** undefined until the session check answers. */
  user: User | null | undefined;
  setUser: (user: User | null) => void;
  path: string;
  navigate: (to: string, replace?: boolean) => void;
  setBand: (band: Band) => void;
  pending: (copy: string) => void;
  done: (copy: string) => void;
  fail: (copy: string) => void;
}

const DeskContext = createContext<DeskState | null>(null);

export function useDesk(): DeskState {
  const desk = useContext(DeskContext);
  if (!desk) throw new Error("useDesk outside the desk");
  return desk;
}

/** Sets the band for the current screen. */
export function useBand(band: Band | null): void {
  const { setBand } = useDesk();
  const key = band ? `${band.name}|${band.target}|${band.fallback}` : "";
  useEffect(() => {
    if (band) setBand(band);
  }, [key]);
}

/** Runs an async action with its pending, success and error copy, and returns the result. */
export function useAction() {
  const desk = useDesk();
  return async function run<T>(pending: string, call: () => Promise<Result<T>>, success?: (data: T) => string | null): Promise<Result<T>> {
    desk.pending(pending);
    const result = await call();
    if (result.ok) {
      const copy = success?.(result.data);
      if (copy) desk.done(copy);
      else desk.done("");
    } else {
      desk.fail(result.message);
    }
    return result;
  };
}

function remaining(target: string, now: number): { text: string; final: boolean } {
  const left = Math.floor((Date.parse(target) - now) / 1000);
  if (left <= 0) return { text: "Closed", final: true };
  const two = (n: number) => String(n).padStart(2, "0");
  const days = Math.floor(left / 86400);
  return {
    text: `${days}d ${two(Math.floor((left % 86400) / 3600))}:${two(Math.floor((left % 3600) / 60))}:${two(left % 60)}`,
    final: left < 86400,
  };
}

/** Counts down to the target instant, changing once per second; reads "Closed" at zero until reload. */
function Countdown({ target }: { target: string }) {
  const [now, setNow] = useState(Date.now());
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    setClosed(false);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [target]);
  const shown = closed ? { text: "Closed", final: true } : remaining(target, now);
  useEffect(() => {
    if (shown.text === "Closed") setClosed(true);
  }, [shown.text]);
  return (
    <span role="timer" aria-label="Time remaining" class={`countdown${shown.final ? " countdown--final" : ""}`}>
      {shown.text}
    </span>
  );
}

const NAV: [string, string][] = [["/", "Leaderboard"], ["/gallery", "Gallery"], ["/studio", "Studio"], ["/jury", "Jury"], ["/director", "Director"]];

function section(path: string): string {
  return NAV.slice(1).find(([href]) => path === href || path.startsWith(`${href}/`))?.[0] ?? (path === "/" ? "/" : "");
}

export function Link({ href, children, class: className }: { href: string; children: ComponentChildren; class?: string }) {
  const { navigate } = useDesk();
  return (
    <a href={href} class={className} onClick={(event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      navigate(href);
    }}>{children}</a>
  );
}

function Shell({ band, status, error, children }: { band: Band; status: string; error: string; children: ComponentChildren }) {
  const desk = useDesk();
  const active = section(desk.path.split("?")[0] ?? "/");
  const signOut = async () => {
    desk.pending("Signing out…");
    const result = await del("/api/session");
    if (result.ok || result.status === 401) {
      desk.setUser(null);
      desk.done("");
      desk.navigate("/");
    } else {
      desk.fail(result.message);
    }
  };
  return (
    <>
      <a class="skip" href="#content" onClick={(event) => {
        event.preventDefault();
        document.getElementById("content")?.focus();
      }}>Skip to content</a>
      <header class="band">
        <div class="band__inner">
          <span class="band__name">{band.name}</span>
          {band.target ? <Countdown target={band.target} /> : band.fallback ? <span class="band__note">{band.fallback}</span> : null}
        </div>
      </header>
      <nav class="nav" aria-label="Primary">
        <ul class="nav__list">
          {NAV.map(([href, label]) => (
            <li key={href}>
              <a href={href} class="nav__link" aria-current={active === href ? "page" : undefined} onClick={(event) => {
                if (event.button !== 0 || event.metaKey || event.ctrlKey) return;
                event.preventDefault();
                desk.navigate(href);
              }}>{label}</a>
            </li>
          ))}
          <li class="nav__session">
            {desk.user
              ? <button type="button" class="nav__link nav__button" onClick={signOut}><Icon name="log-out" />Sign out</button>
              : <Link href={`/signin${desk.path.startsWith("/signin") || desk.path.startsWith("/signup") ? "" : `?next=${encodeURIComponent(desk.path)}`}`} class="nav__link">Sign in</Link>}
          </li>
        </ul>
      </nav>
      <div class="deskline">
        <p role="status" aria-label="Desk status" aria-live="polite" class="deskline__status">{status}</p>
        <p role="alert" aria-label="Desk error" class="deskline__error">
          {error ? <><Icon name="x" />{error}</> : null}
        </p>
      </div>
      <main id="content" tabIndex={-1} class="content">{children}</main>
    </>
  );
}

export function DeskProvider({ children }: { children: ComponentChildren }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => {
    void get<{ user: User }>("/api/session").then((session) => setUser(session.ok ? session.data.user : null));
  }, []);
  const [path, setPath] = useState(location.pathname + location.search);
  const [band, setBand] = useState<Band>({ name: "Cutline Jury Desk", target: null });
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const onPop = () => setPath(location.pathname + location.search);
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);
  const desk: DeskState = {
    user, setUser, path,
    navigate: (to, replace = false) => {
      if (replace) history.replaceState(null, "", to);
      else history.pushState(null, "", to);
      setPath(to);
      (document.activeElement as HTMLElement | null)?.blur();
      scrollTo({ top: 0, behavior: "instant" });
    },
    setBand,
    pending: (copy) => {
      setStatus(copy);
      setError("");
    },
    done: (copy) => {
      setStatus(copy);
      setError("");
    },
    fail: (copy) => {
      setStatus("");
      setError(copy);
    },
  };
  useEffect(() => {
    document.title = band.name === "Cutline Jury Desk" ? band.name : `${band.name} · Cutline Jury Desk`;
  }, [band.name]);
  return (
    <DeskContext.Provider value={desk}>
      <Shell band={band} status={status} error={error}>{children}</Shell>
    </DeskContext.Provider>
  );
}

/** Screens for one role: signed-out visitors go to sign-in and come back; other roles see the forbidden copy. */
export function RoleGate({ role, children }: { role: Role; children: ComponentChildren }) {
  const desk = useDesk();
  useEffect(() => {
    if (desk.user === null) desk.navigate(`/signin?next=${encodeURIComponent(desk.path)}`, true);
  }, [desk.user, desk.path]);
  if (desk.user === undefined) return <p class="loading">Loading…</p>;
  if (desk.user === null) return null;
  if (desk.user.role !== role) return <p class="notice">Only the program director can do that.</p>;
  return <>{children}</>;
}
