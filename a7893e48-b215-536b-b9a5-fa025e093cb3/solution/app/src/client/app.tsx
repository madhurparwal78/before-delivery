import { CircleAlert, LogOut } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useId, useState, type ReactNode } from "react";
import { api, ApiFailure } from "./api.js";
import { Board } from "./board/Board.js";
import { Counter } from "./pages/Counter.js";
import { Documents } from "./pages/Documents.js";
import { Manage } from "./pages/Manage.js";
import { PackPage } from "./pages/Pack.js";
import { Tickets } from "./pages/Tickets.js";
import type { Role, ServiceStatus, Site, User } from "./types.js";

export interface Message { text: string; tone: "pending" | "success" | "error" }

interface AppState {
  user: User;
  sites: Site[];
  billingDelayed: boolean;
  navigate: (path: string) => void;
}

const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const state = useContext(AppContext);
  if (!state) throw new Error("useApp outside the signed-in app");
  return state;
}

/** A polite live region in a fixed, reserved place; pending, success and error copy replace each other. */
export function Live({ label, message, className = "" }: { label: string; message: Message | null; className?: string }) {
  return (
    <p role="status" aria-label={label} className={`live ${message ? `live-${message.tone}` : ""} ${className}`}>
      {message?.tone === "error" ? <CircleAlert aria-hidden="true" size={16} /> : null}
      <span>{message?.text ?? ""}</span>
    </p>
  );
}

/** A labelled select whose label names only the control (the options never leak into its name). */
export function Select({ label, value, onChange, inline = false, children }: { label: string; value: string; onChange: (value: string) => void; inline?: boolean; children: ReactNode }) {
  const id = useId();
  return (
    <div className={`field${inline ? " field-inline" : ""}`}>
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>{children}</select>
    </div>
  );
}

/** The visible "(delayed)" suffix; the control's accessible name stays as the brief lists it. */
export function Delayed() {
  const { billingDelayed } = useApp();
  return billingDelayed ? <span className="delayed" aria-hidden="true"> (delayed)</span> : null;
}

const NAV: Record<Role, string[]> = {
  renter: ["Board", "Tickets", "Pack", "Documents"],
  front_desk: ["Board", "Counter"],
  manager: ["Board", "Counter", "Manage"],
};

const LANDING: Record<Role, string> = { renter: "/board", front_desk: "/counter", manager: "/manage" };

function Banner({ status }: { status: ServiceStatus | null }) {
  const lines = [
    status?.billing === "delayed" ? "Card payments are delayed: billing is unreachable. Pack bookings still work." : null,
    status?.mail === "delayed" ? "Emails are delayed and will send automatically when mail is back." : null,
  ].filter((line): line is string => line !== null);
  return (
    <div role="status" aria-label="Service status" className="banner" hidden={lines.length === 0}>
      {lines.map((line) => <p key={line}><CircleAlert aria-hidden="true" size={18} /><span>{line}</span></p>)}
    </div>
  );
}

function TopBar({ user, path, navigate, onSignOut }: { user: User; path: string; navigate: (path: string) => void; onSignOut: () => void }) {
  return (
    <header className="topbar">
      <a className="brand" href={LANDING[user.role]} onClick={(event) => { event.preventDefault(); navigate(LANDING[user.role]); }}>
        <svg aria-hidden="true" viewBox="0 0 32 32" width="28" height="28"><circle cx="16" cy="16" r="12" fill="none" stroke="currentColor" strokeWidth="3" /><path d="M16 4a12 12 0 0 1 10.4 6" fill="none" stroke="var(--accent)" strokeWidth="5" /><circle cx="16" cy="16" r="2.5" fill="currentColor" /></svg>
        <span className="brand-name">Hearthshift</span>
        <span className="brand-by">Pilot Light Co.</span>
      </a>
      <nav aria-label="Main" className="nav">
        <ul>
          {NAV[user.role].map((name) => {
            const href = `/${name.toLowerCase()}`;
            return (
              <li key={name}>
                <a href={href} aria-current={path === href ? "page" : undefined} onClick={(event) => { event.preventDefault(); navigate(href); }}>{name}</a>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="who">
        <span className="who-name">{user.name}</span>
        <button type="button" className="button button-quiet" onClick={onSignOut}><LogOut aria-hidden="true" size={18} /><span>Sign out</span></button>
      </div>
    </header>
  );
}

function SignIn({ onSignedIn }: { onSignedIn: (user: User) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<Message | null>(null);
  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setMessage({ text: "Signing in…", tone: "pending" });
    try {
      const result = await api<{ user: User }>("POST", "/api/session", { email, password });
      setMessage(null);
      onSignedIn(result.user);
    } catch (error) {
      setMessage({ text: error instanceof ApiFailure && error.status === 401 ? "Email or password is wrong." : "Signing in failed. Try again.", tone: "error" });
    }
  };
  return (
    <main className="signin">
      <form className="signin-card slip" onSubmit={(event) => void submit(event)} noValidate>
        <p className="eyebrow">Pilot Light Co.</p>
        <h1>Hearthshift</h1>
        <p className="signin-lede">Station time, packs and paperwork for the shared kitchen.</p>
        <label className="field">
          <span>Email</span>
          <input type="email" name="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" name="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
        </label>
        <button type="submit" className="button button-primary button-wide">Sign in</button>
        <Live label="Sign-in status" message={message} />
      </form>
    </main>
  );
}

function Page({ path }: { path: string }): ReactNode {
  switch (path) {
    case "/board": return <Board />;
    case "/tickets": return <Tickets />;
    case "/pack": return <PackPage />;
    case "/documents": return <Documents />;
    case "/counter": return <Counter />;
    case "/manage": return <Manage />;
    default: return null;
  }
}

export function App() {
  const [path, setPath] = useState(window.location.pathname);
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [sites, setSites] = useState<Site[]>([]);
  const [status, setStatus] = useState<ServiceStatus | null>(null);

  const navigate = useCallback((to: string) => {
    if (to !== window.location.pathname) window.history.pushState(null, "", to);
    setPath(to);
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    const back = (): void => setPath(window.location.pathname);
    window.addEventListener("popstate", back);
    api<{ user: User }>("GET", "/api/me").then((result) => setUser(result.user), () => setUser(null));
    return () => window.removeEventListener("popstate", back);
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    void api<{ sites: Site[] }>("GET", "/api/sites").then((result) => setSites(result.sites));
    const poll = (): void => { api<ServiceStatus>("GET", "/api/status").then(setStatus, () => undefined); };
    poll();
    const timer = window.setInterval(poll, 5000);
    return () => window.clearInterval(timer);
  }, [user]);

  useEffect(() => {
    if (user === undefined) return;
    const allowed = user ? NAV[user.role].map((name) => `/${name.toLowerCase()}`) : ["/"];
    if (!allowed.includes(path)) navigate(user ? LANDING[user.role] : "/");
  }, [user, path, navigate]);

  if (user === undefined) return <main className="booting" aria-busy="true" />;
  if (user === null) return <SignIn onSignedIn={(signedIn) => { setUser(signedIn); navigate(LANDING[signedIn.role]); }} />;

  const signOut = async (): Promise<void> => {
    await api("DELETE", "/api/session");
    setUser(null);
    setSites([]);
    navigate("/");
  };

  return (
    <AppContext.Provider value={{ user, sites, billingDelayed: status?.billing === "delayed", navigate }}>
      <TopBar user={user} path={path} navigate={navigate} onSignOut={() => void signOut()} />
      <Banner status={status} />
      {sites.length > 0 ? <Page key={path} path={path} /> : <main className="page" aria-busy="true" />}
    </AppContext.Provider>
  );
}
