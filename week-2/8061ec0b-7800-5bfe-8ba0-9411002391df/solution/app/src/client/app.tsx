// The app shell: history routing, the signed-in user, the route guard (sign-in landing rule) and the top bar.

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import type { User } from "../shared/api.js";
import { isPublicRoute, landingFor, ROLE_HOME, routeOpenTo } from "../shared/landing.js";
import { call } from "./api.js";
import { TopBar } from "./components/TopBar.js";
import { ContractSheet } from "./pages/ContractSheet.js";
import { Family } from "./pages/Family.js";
import { PriceLists } from "./pages/PriceLists.js";
import { Register } from "./pages/Register.js";
import { Reserve } from "./pages/Reserve.js";
import { Roster } from "./pages/Roster.js";
import { Schools } from "./pages/Schools.js";
import { SignIn } from "./pages/SignIn.js";
import { Signing } from "./pages/Signing.js";

interface Location { path: string; search: string }

interface AppState {
  location: Location;
  navigate: (to: string, options?: { replace?: boolean }) => void;
  user: User | null;
  setUser: (user: User | null) => void;
}

const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const state = useContext(AppContext);
  if (state === null) throw new Error("useApp outside the app");
  return state;
}

/** A user the route guard has already required. */
export function useUser(): User {
  const { user } = useApp();
  if (user === null) throw new Error("signed-in page rendered without a user");
  return user;
}

function current(): Location {
  return { path: window.location.pathname, search: window.location.search };
}

export function App(): ReactNode {
  const [location, setLocation] = useState(current);
  const [user, setUser] = useState<User | null>(null);
  const [checked, setChecked] = useState(false);

  const navigate = useCallback((to: string, options: { replace?: boolean } = {}) => {
    if (options.replace) window.history.replaceState(null, "", to);
    else window.history.pushState(null, "", to);
    setLocation(current());
    if (!options.replace) window.scrollTo({ top: 0 });
  }, []);

  useEffect(() => {
    const onPop = (): void => setLocation(current());
    window.addEventListener("popstate", onPop);
    void call<{ user: User }>("GET", "/api/me").then((result) => {
      setUser(result.ok ? result.data.user : null);
      setChecked(true);
    });
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const pathWithQuery = location.path + location.search;
  const redirect = !checked ? null
    : location.path === "/" ? (user ? landingFor(user.role, new URLSearchParams(location.search).get("next")) : null)
      : isPublicRoute(location.path) ? null
        : user === null ? `/?next=${encodeURIComponent(pathWithQuery)}`
          : routeOpenTo(user.role, location.path) ? null : ROLE_HOME[user.role];

  useLayoutEffect(() => {
    if (redirect !== null) navigate(redirect, { replace: true });
  }, [redirect, navigate]);

  if (!checked || redirect !== null) return <div className="boot" aria-busy="true" />;

  const signing = /^\/sign\/([^/]+)$/.exec(location.path);
  const contract = /^\/contracts\/([^/]+)$/.exec(location.path);
  let page: ReactNode;
  if (signing) page = <Signing token={decodeURIComponent(signing[1])} />;
  else if (location.path === "/") page = <SignIn />;
  else if (contract) page = <ContractSheet key={contract[1]} id={decodeURIComponent(contract[1])} />;
  else if (location.path === "/register") page = <Register />;
  else if (location.path === "/family") page = <Family />;
  else if (location.path === "/reserve") page = <Reserve />;
  else if (location.path === "/price-lists") page = <PriceLists />;
  else if (location.path === "/schools") page = <Schools />;
  else page = <Roster key={location.search} />;

  return (
    <AppContext.Provider value={{ location, navigate, user, setUser }}>
      {user !== null && !signing && location.path !== "/" && <TopBar />}
      <main id="main" className={signing || location.path === "/" ? "main main--bare" : "main"}>{page}</main>
    </AppContext.Provider>
  );
}

/** An in-app link: plain anchor semantics, client-side navigation. */
export function Link({ to, children, className, onFollow }: { to: string; children: ReactNode; className?: string;
  onFollow?: (anchor: HTMLAnchorElement) => void }): ReactNode {
  const { navigate } = useApp();
  return (
    <a href={to} className={className} onClick={(event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      event.preventDefault();
      onFollow?.(event.currentTarget);
      navigate(to);
    }}>{children}</a>
  );
}
