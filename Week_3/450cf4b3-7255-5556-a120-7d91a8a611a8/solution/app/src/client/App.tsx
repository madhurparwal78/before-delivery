import type { ComponentChildren, JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { Kitchen, Me } from "../shared/api.js";
import { api, nextUserEpoch, whenSessionEnds } from "./api.js";
import { GENERIC, SESSION_ENDED } from "./copy.js";
import { discardDraftExcept, keepDraftOnSessionEnd } from "./draft.js";
import { clockLine, kitchenNow } from "./kitchen.js";
import { discardAttemptsExcept } from "./purchase.js";
import { navigate, nextFor, onLocation, openTo, parseScreen, type Screen } from "./router.js";
import { Apply, SignIn } from "./screens/Access.js";
import { Board } from "./screens/Board.js";
import { Documents } from "./screens/Documents.js";
import { Packs } from "./screens/Packs.js";
import { Receipt } from "./screens/Receipt.js";
import { Report } from "./screens/Report.js";
import { TenantDetail, Tenants } from "./screens/Tenants.js";
import { announce, Icon, landOn, tell } from "./ui.js";

export interface Session {
  me: Me;
  kitchen: Kitchen;
  refreshMe: () => Promise<Me | null>;
  signOut: () => Promise<void>;
}

const NAV: Readonly<Record<Me["role"], readonly { href: string; label: string; icon: string; screen: Screen["name"][] }[]>> = {
  tenant: [
    { href: "/board", label: "Board", icon: "layout-grid", screen: ["board"] },
    { href: "/packs", label: "Hour packs", icon: "clock-3", screen: ["packs"] },
    { href: "/documents", label: "Documents", icon: "file-check-2", screen: ["documents"] },
  ],
  owner: [
    { href: "/board", label: "Board", icon: "layout-grid", screen: ["board"] },
    { href: "/tenants", label: "Tenants", icon: "users", screen: ["tenants", "tenant"] },
    { href: "/report", label: "Report", icon: "chart-column", screen: ["report"] },
  ],
  shift_lead: [{ href: "/board", label: "Board", icon: "layout-grid", screen: ["board"] }],
};

const MENU_PANEL = "main-menu";

function useLocation(): string {
  const [where, setWhere] = useState(location.pathname + location.search);
  useEffect(() => onLocation(() => setWhere(location.pathname + location.search)), []);
  return where;
}

function KitchenClockText({ kitchen }: { kitchen: Kitchen }): JSX.Element {
  const [, setTick] = useState(0);
  useEffect(() => {
    let timer = 0;
    const schedule = (): void => {
      timer = window.setTimeout(() => {
        setTick((t) => t + 1);
        schedule();
      }, 60_000 - (kitchenNow() % 60_000) + 50);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [kitchen]);
  return <p class="clock">{clockLine(kitchen)}</p>;
}

/** Header, navigation and the second rule holding the clock and, on Board and Report, the date group. */
export function Shell({ session, screen, tools, children }: { session: Session; screen: Screen; tools?: ComponentChildren; children: ComponentChildren }): JSX.Element {
  const [signingOut, setSigningOut] = useState(false);
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) panel.current?.querySelector("a")?.focus();
  }, [open]);

  const signOut = async (): Promise<void> => {
    setSigningOut(true);
    await session.signOut();
    setSigningOut(false);
  };

  return (
    <div class="shell">
      <header class="masthead">
        <div class="masthead__bar" onKeyDown={(e) => {
          if (e.key === "Escape" && open) {
            setOpen(false);
            menuButton.current?.focus();
          }
        }}>
          <a class="brand" href="/board" onClick={(e) => { e.preventDefault(); navigate("/board"); }} tabIndex={-1}>
            <span class="brand__mark" aria-hidden="true" />
            <span class="brand__name">Stationhouse</span>
            <span class="brand__kitchen">{session.kitchen.name}</span>
          </a>
          <button type="button" ref={menuButton} class="button menu-button" aria-expanded={open ? "true" : "false"} aria-controls={MENU_PANEL}
            onClick={() => setOpen(!open)}>Menu</button>
          <div class="menu" id={MENU_PANEL} ref={panel} data-open={open ? "true" : "false"}>
            <nav class="nav" aria-label="Main">
              {NAV[session.me.role].map((item) => (
                <a key={item.href} href={item.href} class="nav__link" aria-current={item.screen.includes(screen.name) ? "page" : undefined}
                  onClick={(e) => { e.preventDefault(); setOpen(false); navigate(item.href); }}>
                  <Icon name={item.icon} />{item.label}
                </a>
              ))}
            </nav>
            <button type="button" class="button button--quiet signout" onClick={() => void signOut()} disabled={signingOut}>
              <Icon name="log-out" />Sign out
            </button>
          </div>
        </div>
        <div class="masthead__tools">
          {tools}
          <KitchenClockText kitchen={session.kitchen} />
        </div>
      </header>
      <main class="page" id="main">{children}</main>
    </div>
  );
}

export function App(): JSX.Element | null {
  const where = useLocation();
  const [kitchen, setKitchen] = useState<Kitchen | null>(null);
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [bootError, setBootError] = useState(false);
  const signedIn = useRef(false);
  const currentUser = useRef<string | null>(null);

  /**
   * Discards every in-page record of the previous user, then shows `user` at `path`. A session that merely
   * ended (a 401) keeps the open purchase attempt and the upload draft for the same account's next sign-in.
   */
  const changeUser = (user: Me | null, path: string, ended = false): void => {
    nextUserEpoch();
    const keep = ended ? currentUser.current : user?.id ?? null;
    discardAttemptsExcept(keep);
    discardDraftExcept(keep);
    announce("");
    signedIn.current = user !== null;
    currentUser.current = user?.id ?? (ended ? currentUser.current : null);
    navigate(path, { replace: true });
    setMe(user);
  };

  const refreshMe = async (): Promise<Me | null> => {
    const result = await api<Me>("GET", "/api/me");
    if (result.ok) {
      signedIn.current = true;
      currentUser.current = result.data.id;
      setMe(result.data);
      return result.data;
    }
    if (result.status === 401) setMe(null);
    else setBootError(true);
    return null;
  };

  const signOut = async (): Promise<void> => {
    const result = await api("DELETE", "/api/session");
    if (result.status === 0) {
      tell(GENERIC, "outage");
      return;
    }
    landOn("email");
    changeUser(null, "/signin");
  };

  useEffect(() => {
    whenSessionEnds(() => {
      if (!signedIn.current) return;
      const here = location.pathname + location.search;
      landOn("email", SESSION_ENDED);
      keepDraftOnSessionEnd();
      changeUser(null, `/signin?next=${nextFor(here)}`, true);
    });
    void (async () => {
      const k = await api<Kitchen>("GET", "/api/kitchen");
      if (k.ok) setKitchen(k.data);
      else setBootError(true);
      await refreshMe();
    })();
  }, []);

  const url = new URL(where, location.origin);
  const screen = parseScreen(url.pathname);

  useEffect(() => {
    if (me === undefined) return;
    if (me === null) {
      if (screen.name === "signin" || screen.name === "apply") return;
      const next = screen.name === "home" ? "" : `?next=${nextFor(url.pathname + url.search)}`;
      navigate(`/signin${next}`, { replace: true });
    } else if (screen.name === "signin" || screen.name === "apply" || screen.name === "home") {
      navigate("/board", { replace: true });
    } else if (!openTo(screen, me.role)) {
      landOn("heading");
      navigate("/board", { replace: true });
    }
  }, [me, where]);

  if (bootError && (!kitchen || me === undefined)) {
    return <main class="access"><p class="notice notice--outage">{GENERIC}</p></main>;
  }
  if (!kitchen || me === undefined) return null;
  if (me === null) {
    if (screen.name === "apply") return <Apply onApplied={(user) => changeUser(user, "/documents")} />;
    if (screen.name !== "signin") return null;
    return <SignIn search={url.search} onSignedIn={changeUser} />;
  }
  if (!openTo(screen, me.role)) return null;
  const session: Session = { me, kitchen, refreshMe, signOut };
  return <Screens key={me.id} session={session} screen={screen} search={url.search} />;
}

/** Keyed by user, so nothing a screen holds survives a change of user. */
function Screens({ session, screen, search }: { session: Session; screen: Screen; search: string }): JSX.Element | null {
  switch (screen.name) {
    case "board":
      return <Board session={session} screen={screen} search={search} />;
    case "packs":
      return <Packs session={session} screen={screen} />;
    case "documents":
      return <Documents session={session} screen={screen} />;
    case "tenants":
      return <Tenants session={session} screen={screen} />;
    case "tenant":
      return <TenantDetail key={screen.id} session={session} screen={screen} id={screen.id} />;
    case "report":
      return <Report session={session} screen={screen} search={search} />;
    case "receipt":
      return <Receipt key={screen.id} session={session} screen={screen} id={screen.id} />;
    default:
      return null;
  }
}
