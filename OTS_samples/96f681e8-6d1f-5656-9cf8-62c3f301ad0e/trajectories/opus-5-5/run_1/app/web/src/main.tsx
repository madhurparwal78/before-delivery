import { render } from "preact";
import { createContext } from "preact";
import { useContext, useEffect, useRef, useState } from "preact/hooks";
import "./styles.css";
import {
  Club,
  DRAFT_KEY,
  Me,
  clearAnnouncements,
  get,
  loginURL,
  onAnnounce,
  onLinkClick,
  setClubZone,
  syncServerClock,
  useLocation,
} from "./lib";
import { HomePage, MatchesPage } from "./home";
import { CourtsPage } from "./courts";
import { BookingPage, MyBookingsPage, SharePage } from "./player";
import { DeskPage } from "./desk";
import { CoachPage } from "./coach";
import { ManagerPage } from "./manager";

export type Session = { me: Me | null; club: Club };
export const SessionContext = createContext<Session>(null as unknown as Session);
export const useSession = () => useContext(SessionContext);

function Wordmark() {
  return (
    <a class="wordmark" href="/">
      MARLOWE YARD
    </a>
  );
}

function PersonIcon() {
  return (
    <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8" r="4" fill="currentColor" />
      <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" fill="currentColor" />
    </svg>
  );
}

function signOut() {
  sessionStorage.removeItem(DRAFT_KEY);
  clearAnnouncements();
  const form = document.createElement("form");
  form.method = "POST";
  form.action = "/logout";
  document.body.appendChild(form);
  render(null, document.getElementById("app")!);
  form.submit();
}

function AccountMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const item = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    item.current?.focus();
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div class="account" ref={ref}>
      <button
        ref={button}
        type="button"
        class={"pill pill-lime account-pill" + (open ? " open" : "")}
        aria-label="Account"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <PersonIcon />
        <span>Account</span>
        <svg class="chevron" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" stroke-width="2" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          class="menu"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false);
              button.current?.focus();
            }
          }}
        >
          <button ref={item} type="button" role="menuitem" class="menu-item" onClick={signOut}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function Header({ path }: { path: string }) {
  const { me } = useSession();
  const [menu, setMenu] = useState(false);
  useEffect(() => setMenu(false), [path]);
  const roles = me?.roles ?? [];
  const links: [string, string][] = [
    ["/courts", "Courts"],
    ["/matches", "Matches"],
    ["/me", "My bookings"],
  ];
  if (roles.includes("desk") || roles.includes("manager")) links.push(["/desk", "Desk"]);
  if (roles.includes("coach")) links.push(["/coach", "Coach"]);
  if (roles.includes("manager")) links.push(["/manager", "Manager"]);
  return (
    <header class="site-header">
      <div class="header-inner">
        <Wordmark />
        <nav aria-label="Main" class={"main-nav" + (menu ? " open" : "")}>
          {links.map(([href, label]) => (
            <a href={href} aria-current={path === href ? "page" : undefined}>
              {label}
            </a>
          ))}
        </nav>
        {me ? (
          <AccountMenu />
        ) : (
          <a class="pill pill-lime account-pill" href={loginURL(location.pathname + location.search)}>
            <PersonIcon />
            <span>Sign in</span>
          </a>
        )}
        <button
          type="button"
          class="pill pill-lime menu-pill"
          aria-label="Menu"
          aria-expanded={menu}
          onClick={() => setMenu(!menu)}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true" class="icon">
            <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" stroke-width="2" />
          </svg>
        </button>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer class="site-footer">
      <div class="column footer-inner">
        <p class="footer-mark">Marlowe Yard Padel Club</p>
        <div class="footer-cols">
          <div>
            <h2 class="footer-head">Play</h2>
            <ul>
              <li><a href="/courts">Courts</a></li>
              <li><a href="/matches">Matches</a></li>
              <li><a href="/me">My bookings</a></li>
            </ul>
          </div>
          <div>
            <h2 class="footer-head">Club</h2>
            <ul>
              <li><a href="/#house-rules">House rules</a></li>
              <li><a href="/#coaches">Coaches</a></li>
            </ul>
          </div>
        </div>
        <p class="copyright">© 2026 Marlowe Yard Padel Club</p>
      </div>
    </footer>
  );
}

export function NotFound() {
  return (
    <div class="column page">
      <h1>We could not find that page.</h1>
    </div>
  );
}

function NotForRole() {
  return (
    <div class="column page">
      <h1>This page is not for your role.</h1>
    </div>
  );
}

const signedInPages = [/^\/courts$/, /^\/me$/, /^\/desk$/, /^\/coach$/, /^\/manager$/, /^\/share\/[^/]+$/, /^\/bookings\/[^/]+$/];

function Page({ path, query }: { path: string; query: URLSearchParams }) {
  const { me } = useSession();
  if (!me && signedInPages.some((r) => r.test(path))) {
    location.assign(loginURL(path + location.search));
    return null;
  }
  const roles = me?.roles ?? [];
  if (path === "/") return <HomePage />;
  if (path === "/matches") return <MatchesPage query={query} />;
  if (path === "/courts") return <CourtsPage query={query} />;
  if (path === "/me") return <MyBookingsPage />;
  const share = path.match(/^\/share\/([^/]+)$/);
  if (share) return <SharePage token={decodeURIComponent(share[1])} />;
  const booking = path.match(/^\/bookings\/([^/]+)$/);
  if (booking) return <BookingPage id={decodeURIComponent(booking[1])} />;
  if (path === "/desk") return roles.includes("desk") || roles.includes("manager") ? <DeskPage /> : <NotForRole />;
  if (path === "/coach") return roles.includes("coach") ? <CoachPage /> : <NotForRole />;
  if (path === "/manager") return roles.includes("manager") ? <ManagerPage query={query} /> : <NotForRole />;
  return <NotFound />;
}

function StatusRegion() {
  const [text, setText] = useState("");
  useEffect(() => onAnnounce(setText), []);
  return (
    <div role="status" aria-label="Announcements" aria-live="polite" class="announcer">
      {text}
    </div>
  );
}

function App({ session }: { session: Session }) {
  const { path, query } = useLocation();
  useEffect(() => {
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  }, [path]);
  return (
    <SessionContext.Provider value={session}>
      <div class="frame" onClick={onLinkClick}>
        <Header path={path} />
        <main id="main">
          <Page key={path} path={path} query={query} />
        </main>
        <Footer />
        <StatusRegion />
      </div>
    </SessionContext.Provider>
  );
}

async function boot() {
  const [meAnswer, clubAnswer] = await Promise.all([get<Me>("/api/me"), get<Club>("/api/club")]);
  const me = meAnswer.status === 200 ? meAnswer.data : null;
  const club = clubAnswer.data;
  setClubZone(club.timezone);
  syncServerClock(meAnswer.headers.get("Date") ? new Date(meAnswer.headers.get("Date")!).toISOString() : undefined);
  const raw = sessionStorage.getItem(DRAFT_KEY);
  if (raw) {
    try {
      if (!me || JSON.parse(raw).username !== me.username) sessionStorage.removeItem(DRAFT_KEY);
    } catch {
      sessionStorage.removeItem(DRAFT_KEY);
    }
  }
  render(<App session={{ me, club }} />, document.getElementById("app")!);
}

boot();
