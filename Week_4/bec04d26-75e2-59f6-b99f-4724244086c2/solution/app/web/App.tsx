import { useEffect } from "react";
import { isPage } from "../shared/routes";
import type { Me } from "../shared/types";
import { Announcements, ServiceNotice, TopBar } from "./components/Shell";
import { Catalogue } from "./pages/Catalogue";
import { Clients } from "./pages/Clients";
import { Month } from "./pages/Month";
import { NotFound } from "./pages/NotFound";
import { OwnerHome } from "./pages/OwnerHome";
import { ReturnPage } from "./pages/ReturnPage";
import { Settings } from "./pages/Settings";
import { SignIn, SignUp } from "./pages/Auth";
import { States } from "./pages/States";
import { Today } from "./pages/Today";
import { Year } from "./pages/Year";
import { navigate, useLocation } from "./router";
import { homeFor, loadSession } from "./session";
import { useApp } from "./store";

const PUBLIC = ["/sign-in", "/sign-up"];
const BOOKKEEPER_ONLY = /^\/(today|catalogue|month|year|clients|states|settings)(\/|$)/;

/** Where a visitor must go instead of the page they asked for, if anywhere. */
function redirectFor(me: Me | null, path: string): string | null {
  if (!isPage(path)) return null;
  if (!me) return PUBLIC.includes(path) ? null : "/sign-in";
  if (path === "/" || PUBLIC.includes(path)) return homeFor(me);
  if (me.user.role === "owner" && BOOKKEEPER_ONLY.test(path)) return "/home";
  if (me.user.role === "bookkeeper" && path === "/home") return "/today";
  return null;
}

function Screen({ path, me }: { path: string; me: Me }) {
  const clock = useApp((s) => s.clock);
  const month = /^\/month(?:\/(\d{4}-\d{2}))?$/.exec(path);
  const year = /^\/year(?:\/(\d{4}))?$/.exec(path);
  const id = /^\/returns\/([^/]+)$/.exec(path)?.[1];
  if (month) return clock && <Month month={month[1] ?? clock.today.slice(0, 7)} key={month[1] ?? "current"} />;
  if (year) return clock && <Year year={year[1] ?? clock.today.slice(0, 4)} />;
  if (id) return <ReturnPage id={id} role={me.user.role} key={id} />;
  switch (path) {
    case "/today": return <Today />;
    case "/catalogue": return <Catalogue />;
    case "/clients": return <Clients />;
    case "/states": return <States />;
    case "/settings": return <Settings />;
    case "/home": return <OwnerHome />;
    default: return null;
  }
}

export function App() {
  const me = useApp((s) => s.me);
  const { path } = useLocation();
  useEffect(() => {
    void loadSession();
  }, []);
  const target = me === undefined ? null : redirectFor(me, path);
  useEffect(() => {
    if (target) navigate(target, true);
  }, [target]);

  const ready = me !== undefined && !target;
  let content = null;
  if (ready) {
    if (!isPage(path)) content = <NotFound />;
    else if (!me) content = path === "/sign-up" ? <SignUp /> : <SignIn />;
    else content = <Screen path={path} me={me} />;
  }
  const signedIn = ready && me && isPage(path);
  return (
    <>
      {signedIn && me.user.role === "bookkeeper" && <ServiceNotice />}
      {signedIn && <TopBar wordmark={path !== "/today"} />}
      <Announcements />
      {content}
    </>
  );
}
