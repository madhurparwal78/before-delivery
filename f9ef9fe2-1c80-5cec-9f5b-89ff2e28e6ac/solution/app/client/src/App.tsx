import { useEffect, useState } from "react";
import { call } from "./api";
import { navigate, useLocation } from "./router";
import { type Session, SessionContext, ServicesContext, useServiceStatus } from "./session";
import { BillingScreen } from "./screens/Billing";
import { BookingsScreen } from "./screens/Bookings";
import { LoomScreen } from "./loom/LoomScreen";
import { MembersScreen } from "./screens/Members";
import { PapersScreen } from "./screens/Papers";
import { RatesScreen } from "./screens/Rates";
import { ReportsScreen } from "./screens/Reports";
import { SignInScreen } from "./screens/SignIn";
import type { Kitchen, Role, User } from "./types";

const SCREENS: { path: string; name: string; roles: Role[] }[] = [
  { path: "/loom", name: "Loom", roles: ["operator", "member"] },
  { path: "/bookings", name: "Bookings", roles: ["operator", "member", "bookkeeper"] },
  { path: "/papers", name: "Papers", roles: ["operator", "member"] },
  { path: "/billing", name: "Billing", roles: ["member"] },
  { path: "/members", name: "Members", roles: ["operator"] },
  { path: "/rates", name: "Rates", roles: ["operator"] },
  { path: "/reports", name: "Reports", roles: ["operator", "bookkeeper"] },
];

const landingFor = (role: Role): string => (role === "bookkeeper" ? "/reports" : "/loom");

async function loadSession(user: User): Promise<Session | null> {
  const kitchen = await call<{ kitchen: Kitchen }>("GET", `/api/kitchens/${user.kitchen_id}`);
  if (!kitchen.ok) return null;
  return { user, kitchen: kitchen.data.kitchen, clockOffset: Date.parse(kitchen.data.kitchen.server_now) - Date.now() };
}

function ServiceBanner({ lines }: { lines: string[] }) {
  return (
    <div className="banner" data-open={lines.length > 0 ? "true" : "false"}>
      <div className="banner-inner" role="status" aria-label="Service status">
        {lines.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
    </div>
  );
}

function TopBar({ session, path, onSignOut }: { session: Session; path: string; onSignOut: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const links = SCREENS.filter((s) => s.roles.includes(session.user.role));
  return (
    <header className="topbar">
      <div className="brand">
        <span className="wordmark">Pilotlight</span>
        <span className="kitchen-name">{session.kitchen.name}</span>
      </div>
      <button type="button" className="menu-button" aria-expanded={menuOpen} aria-controls="main-nav" onClick={() => setMenuOpen((o) => !o)}>
        Menu
      </button>
      <nav id="main-nav" aria-label="Main" className="nav" data-open={menuOpen ? "true" : "false"}>
        {links.map((link) => (
          <a
            key={link.path}
            href={link.path}
            aria-current={path === link.path ? "page" : undefined}
            onClick={(event) => {
              event.preventDefault();
              setMenuOpen(false);
              navigate(link.path);
            }}
          >
            {link.name}
          </a>
        ))}
      </nav>
      <button type="button" className="ghost signout" onClick={onSignOut}>
        Sign out
      </button>
    </header>
  );
}

export function App() {
  const location = useLocation();
  const services = useServiceStatus();
  const [session, setSession] = useState<Session | null | "loading">("loading");
  const path = location.pathname;

  useEffect(() => {
    let alive = true;
    void (async () => {
      const me = await call<{ user: User }>("GET", "/api/me");
      const next = me.ok ? await loadSession(me.data.user) : null;
      if (alive) setSession(next);
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (session === "loading") return;
    if (!session && path !== "/signin") navigate("/signin", true);
    if (session) {
      const allowed = SCREENS.some((s) => s.path === path && s.roles.includes(session.user.role));
      if (!allowed) navigate(landingFor(session.user.role), true);
    }
  }, [session, path]);

  const signedIn = async (user: User): Promise<void> => {
    const next = await loadSession(user);
    setSession(next);
    if (next) navigate(landingFor(user.role));
  };

  const signOut = async (): Promise<void> => {
    await call("DELETE", "/api/session");
    setSession(null);
    navigate("/signin");
  };

  if (session === "loading") {
    return (
      <ServicesContext.Provider value={services}>
        <ServiceBanner lines={services.lines} />
      </ServicesContext.Provider>
    );
  }

  if (!session || path === "/signin") {
    return (
      <ServicesContext.Provider value={services}>
        <ServiceBanner lines={services.lines} />
        <SignInScreen onSignedIn={signedIn} />
      </ServicesContext.Provider>
    );
  }

  return (
    <SessionContext.Provider value={session}>
      <ServicesContext.Provider value={services}>
        <TopBar session={session} path={path} onSignOut={() => void signOut()} />
        <ServiceBanner lines={services.lines} />
        <main className={path === "/loom" ? "main main-loom" : "main"}>
          {path === "/loom" && <LoomScreen key={session.user.id} />}
          {path === "/bookings" && <BookingsScreen />}
          {path === "/papers" && <PapersScreen />}
          {path === "/billing" && <BillingScreen />}
          {path === "/members" && <MembersScreen />}
          {path === "/rates" && <RatesScreen />}
          {path === "/reports" && <ReportsScreen />}
        </main>
      </ServicesContext.Provider>
    </SessionContext.Provider>
  );
}
