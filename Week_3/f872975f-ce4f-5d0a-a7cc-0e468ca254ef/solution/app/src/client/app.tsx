// The shell: top bar, service notice, routing between the screens.
import { forwardRef, useEffect, type ReactNode } from "react";
import type { Role } from "../shared/api";
import { api, loadSession, navigate, refreshServices, sessionStore, signInPath, useLocationPath, useServices, useSession } from "./api";
import { DrawingDefs } from "./drawing";
import { Icon } from "./icons";
import { AccountPage } from "./pages/account";
import { BoardPage } from "./pages/board";
import { NotFound } from "./pages/notfound";
import { OwnerPage } from "./pages/owner";
import { RackPage } from "./pages/rack";
import { SignInPage } from "./pages/signin";
import { TicketPage } from "./pages/ticket";
import { YardPage } from "./pages/yard";

const SERVICE_POLL_MS = 4000;

const BANNERS = {
  billing: "Billing is offline. You can browse and plan cuts, but holds and purchases are paused.",
  storage: "Photo storage is offline. Tag boards now and add photos when it's back.",
} as const;

const ROLE_NAMES: Record<Role, string> = { owner: "Owner", hand: "Yard hand", maker: "Maker" };
const LINKS: Record<Role, [string, string][]> = {
  maker: [["/", "Rack"], ["/account", "Account"]],
  hand: [["/", "Rack"], ["/yard", "Yard"]],
  owner: [["/", "Rack"], ["/yard", "Yard"], ["/owner", "Owner"]],
};

/** A link that navigates inside the app without a reload. */
export const Link = forwardRef<HTMLAnchorElement, {
  to: string; children: ReactNode; className?: string; ariaCurrent?: boolean; onBeforeNavigate?: () => void;
}>(function Link({ to, children, className, ariaCurrent, onBeforeNavigate }, ref) {
  return (
    <a
      ref={ref}
      href={to}
      className={className}
      aria-current={ariaCurrent ? "page" : undefined}
      onClick={(e) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        onBeforeNavigate?.();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
});

function TopBar({ path }: { path: string }) {
  const { user } = useSession();
  const signOut = async (): Promise<void> => {
    await api("DELETE", "/api/session");
    sessionStore.set({ loaded: true, user: null });
    navigate("/");
  };
  const pathname = path.split("?")[0] ?? "/";
  return (
    <header className="topbar">
      <Link to="/" className="wordmark">Kerfwell</Link>
      <nav aria-label="Screens" className="topnav">
        {(user ? LINKS[user.role] : [["/", "Rack"] as [string, string]]).map(([to, label]) => (
          <Link key={to} to={to} ariaCurrent={pathname === to}>{label}</Link>
        ))}
      </nav>
      <div className="who">
        {user ? (
          <>
            <span className="who-name">{user.name}<span className="who-role"> · {ROLE_NAMES[user.role]}</span></span>
            <button type="button" className="quiet" onClick={() => void signOut()}>
              <Icon name="log-out" />Sign out
            </button>
          </>
        ) : pathname === "/sign-in" ? null : (
          <Link to={signInPath(pathname)} className="button quiet">Sign in</Link>
        )}
      </div>
    </header>
  );
}

/** Which banners a screen shows. */
function bannersFor(pathname: string): ("billing" | "storage")[] {
  if (pathname === "/" || pathname === "/account" || pathname.startsWith("/boards/")) return ["billing"];
  if (pathname === "/yard" || pathname.startsWith("/tickets/")) return ["storage"];
  return [];
}

function ServiceNotice({ pathname }: { pathname: string }) {
  const services = useServices();
  const shown = bannersFor(pathname).filter((s) => services[s] === "down");
  return (
    <div role="status" aria-label="Service notice" className="notice">
      {shown.map((s) => <p key={s} className="banner">{BANNERS[s]}</p>)}
    </div>
  );
}

const PROTECTED: [RegExp, Role[]][] = [
  [/^\/account$/, ["maker"]],
  [/^\/yard$/, ["owner", "hand"]],
  [/^\/owner$/, ["owner"]],
  [/^\/tickets\/[^/]+$/, ["owner", "hand", "maker"]],
];

function Screen({ pathname }: { pathname: string }) {
  const { loaded, user } = useSession();
  const guard = PROTECTED.find(([re]) => re.test(pathname));
  useEffect(() => {
    if (loaded && guard && user === null) navigate(signInPath(pathname), true);
  }, [loaded, guard, user, pathname]);
  if (guard && (!loaded || user === null)) return <p className="muted loading">Loading…</p>;
  if (guard && user && !guard[1].includes(user.role)) return <NotFound />;
  if (pathname === "/") return <RackPage />;
  if (pathname === "/sign-in") return <SignInPage />;
  if (pathname === "/account") return <AccountPage />;
  if (pathname === "/yard") return <YardPage />;
  if (pathname === "/owner") return <OwnerPage />;
  const board = /^\/boards\/([^/]+)$/.exec(pathname);
  if (board?.[1]) return <BoardPage key={board[1]} tag={decodeURIComponent(board[1])} />;
  const ticket = /^\/tickets\/([^/]+)$/.exec(pathname);
  if (ticket?.[1]) return <TicketPage key={ticket[1]} id={decodeURIComponent(ticket[1])} />;
  return <NotFound />;
}

export function App() {
  const path = useLocationPath();
  const pathname = path.split("?")[0] ?? "/";
  useEffect(() => {
    void loadSession();
    void refreshServices();
    const timer = setInterval(() => void refreshServices(), SERVICE_POLL_MS);
    return () => clearInterval(timer);
  }, []);
  // The bar and the screen depend on who is signed in: draw them once the session is known, so they never redraw in place.
  const { loaded } = useSession();
  if (!loaded) return null;
  return (
    <>
      <DrawingDefs />
      <TopBar path={path} />
      <ServiceNotice pathname={pathname} />
      <main className="page">
        <Screen pathname={pathname} />
      </main>
    </>
  );
}
