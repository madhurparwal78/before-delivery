import { House, LayoutGrid, LogOut, Plus, Search, User } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Exhibit } from "./components/Exhibit";
import { setExhibit } from "./lib/exhibit";
import { navigate, params, useLocation, type Location } from "./lib/router";
import { BoardPage as Board } from "./pages/Board";
import { Boards, ProfilePage, SearchPage } from "./pages/Browse";
import { Create } from "./pages/Create";
import { SignIn, SignUp } from "./pages/Auth";
import { Home } from "./pages/Home";
import { InvitePage } from "./pages/Invite";
import { Landing } from "./pages/Landing";
import { NotFound, type NotFoundHeading } from "./pages/NotFound";
import { PinPage } from "./pages/PinPage";
import { useSession, type Me } from "./session";
import { Link } from "./ui/Link";
import { Regions } from "./ui/Regions";

type Route =
  | { name: "home" }
  | { name: "signin" }
  | { name: "signup" }
  | { name: "boards" }
  | { name: "create" }
  | { name: "search" }
  | { name: "pin"; id: number }
  | { name: "board"; id: number }
  | { name: "profile"; handle: string }
  | { name: "invite"; token: string }
  | { name: "missing"; heading: NotFoundHeading };

function matchRoute(pathname: string): Route {
  const id = (pattern: RegExp): number | null => {
    const found = pattern.exec(pathname);
    return found?.[1] ? Number(found[1]) : null;
  };
  if (pathname === "/") return { name: "home" };
  if (pathname === "/signin") return { name: "signin" };
  if (pathname === "/signup") return { name: "signup" };
  if (pathname === "/boards") return { name: "boards" };
  if (pathname === "/create") return { name: "create" };
  if (pathname === "/search") return { name: "search" };
  const pin = id(/^\/pin\/([1-9][0-9]*)$/);
  if (pin !== null) return { name: "pin", id: pin };
  const board = id(/^\/b\/([1-9][0-9]*)$/);
  if (board !== null) return { name: "board", id: board };
  const profile = /^\/u\/([^/]+)$/.exec(pathname);
  if (profile?.[1]) return { name: "profile", handle: decodeURIComponent(profile[1]) };
  const invite = /^\/invites\/([^/]+)$/.exec(pathname);
  if (invite?.[1]) return { name: "invite", token: decodeURIComponent(invite[1]) };
  if (/^\/pin\//.test(pathname)) return { name: "missing", heading: "Pin not found" };
  if (/^\/b\//.test(pathname)) return { name: "missing", heading: "Board not found" };
  return { name: "missing", heading: "Page not found" };
}

const TABS = (me: Me): { to: string; label: string; icon: ReactNode; match: (path: string) => boolean }[] => [
  { to: "/", label: "Home", icon: <House size={22} aria-hidden="true" />, match: (path) => path === "/" },
  { to: "/search", label: "Search", icon: <Search size={22} aria-hidden="true" />, match: (path) => path === "/search" },
  { to: "/create", label: "Create", icon: <Plus size={22} aria-hidden="true" />, match: (path) => path === "/create" },
  { to: "/boards", label: "Boards", icon: <LayoutGrid size={22} aria-hidden="true" />, match: (path) => path === "/boards" || path.startsWith("/b/") },
  { to: `/u/${me.handle}`, label: "Profile", icon: <User size={22} aria-hidden="true" />, match: (path) => path.startsWith("/u/") },
];

function TopBar({ me, path, search }: { me: Me; path: string; search: string }) {
  const { signOut } = useSession();
  const [typed, setTyped] = useState(path === "/search" ? (params(search).get("q") ?? "") : "");
  useEffect(() => {
    if (path === "/search") setTyped(params(search).get("q") ?? "");
  }, [path, search]);
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    navigate(`/search?q=${encodeURIComponent(typed.trim())}`);
  };
  const tabs = TABS(me);
  return (
    <header className="topbar">
      <Link to="/" className="wordmark">MOTHLIGHT</Link>
      <nav aria-label="Primary" className="nav-primary">
        {tabs.map((tab) => (
          <Link key={tab.label} to={tab.to} aria-current={tab.match(path) ? "page" : undefined}>{tab.label}</Link>
        ))}
      </nav>
      <form role="search" className="searchform" onSubmit={submit}>
        <input type="search" aria-label="Search pins" placeholder="Search pins" value={typed} onChange={(event) => setTyped(event.target.value)} />
      </form>
      <button type="button" className="icon-button signout" aria-label="Sign out" onClick={() => void signOut().then(() => navigate("/", { replace: true }))}>
        <LogOut size={20} aria-hidden="true" />
        <span className="signout-label" aria-hidden="true">Sign out</span>
      </button>
    </header>
  );
}

function TabBar({ me, path }: { me: Me; path: string }) {
  return (
    <nav aria-label="Tabs" className="nav-tabs">
      {TABS(me).map((tab) => (
        <Link key={tab.label} to={tab.to} aria-current={tab.match(path) ? "page" : undefined}>
          {tab.icon}
          <span>{tab.label}</span>
        </Link>
      ))}
    </nav>
  );
}

type ShellRoute = Exclude<Route, { name: "signin" | "signup" | "invite" }>;

function Page({ route }: { route: ShellRoute }) {
  switch (route.name) {
    case "home":
      return <Home />;
    case "boards":
      return <Boards />;
    case "create":
      return <Create />;
    case "search":
      return <SearchPage />;
    case "pin":
      return <PinPage id={route.id} />;
    case "board":
      return <Board id={route.id} />;
    case "profile":
      return <ProfilePage handle={route.handle} />;
    case "missing":
      return <div className="page"><NotFound heading={route.heading} /></div>;
  }
}

const sameLocation = (a: Location, b: { pathname: string; search: string }): boolean => a.pathname === b.pathname && a.search === b.search;

interface Overlay {
  pinId: number;
  cardId: number | null;
  background: { pathname: string; search: string };
}

export function App() {
  const { me } = useSession();
  const location = useLocation();
  const [shown, setShown] = useState<{ overlay: Overlay; closing: boolean } | null>(null);

  const pinMatch = /^\/pin\/([1-9][0-9]*)$/.exec(location.pathname);
  const background = location.state?.background;
  const overlay: Overlay | null = me && pinMatch?.[1] && background ? { pinId: Number(pinMatch[1]), cardId: location.state?.cardId ?? null, background } : null;
  const pageLocation = overlay ? overlay.background : location;
  const route = matchRoute(pageLocation.pathname);
  const publicRoute = route.name === "signin" || route.name === "signup" || route.name === "invite" || route.name === "missing" || (route.name === "home");

  useEffect(() => {
    if (overlay) setShown({ overlay, closing: false });
    else setShown((held) => (held && !held.closing && sameLocation(location, held.overlay.background) ? { ...held, closing: true } : held && !held.closing ? null : held));
  }, [location]);

  useEffect(() => {
    setExhibit({ open: shown !== null && !shown.closing, cardId: shown?.overlay.cardId ?? null, hideCard: shown !== null });
  }, [shown]);

  useEffect(() => {
    if (!me && !publicRoute) navigate(`/signin?next=${encodeURIComponent(location.pathname + location.search)}`, { replace: true });
    if (me && (route.name === "signin" || route.name === "signup")) navigate(params(location.search).get("next") ?? "/", { replace: true });
  }, [me, publicRoute, route.name, location.pathname, location.search]);

  const exited = useCallback(() => setShown(null), []);

  let body: ReactNode = null;
  if (!me) {
    if (route.name === "home") body = <Landing />;
    else if (route.name === "signin") body = <SignIn />;
    else if (route.name === "signup") body = <SignUp />;
    else if (route.name === "invite") body = <InvitePage token={route.token} />;
    else if (route.name === "missing") body = <main className="page"><NotFound heading={route.heading} /></main>;
  } else if (route.name === "invite") {
    body = <InvitePage token={route.token} />;
  } else if (route.name !== "signin" && route.name !== "signup") {
    body = (
      <div className="shell">
        <TopBar me={me} path={pageLocation.pathname} search={pageLocation.search} />
        <main id="main">
          <Page route={route} />
        </main>
        <TabBar me={me} path={pageLocation.pathname} />
      </div>
    );
  }

  return (
    <>
      {body}
      {shown ? <Exhibit key={shown.overlay.pinId} pinId={shown.overlay.pinId} cardId={shown.overlay.cardId} closing={shown.closing} onExited={exited} /> : null}
      <Regions />
    </>
  );
}
