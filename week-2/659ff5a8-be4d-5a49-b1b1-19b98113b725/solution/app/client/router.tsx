import { type AnchorHTMLAttributes, type MouseEvent, createContext, useContext, useEffect, useState } from "react";

type Route =
  | { name: "signin" }
  | { name: "join"; slug: string }
  | { name: "events" }
  | { name: "event"; id: number; section: EventSection }
  | { name: "index-tables" }
  | { name: "season" }
  | { name: "operator" }
  | { name: "unknown" };

export type EventSection = "overview" | "timing" | "rota" | "live" | "protests" | "corrections" | "publish";

function parseRoute(pathname: string): Route {
  const event = /^\/events\/(\d+)(?:\/(timing|rota|live|protests|corrections|publish))?$/.exec(pathname);
  if (event) return { name: "event", id: Number(event[1]), section: (event[2] as EventSection | undefined) ?? "overview" };
  const join = /^\/join\/([^/]+)$/.exec(pathname);
  if (join) return { name: "join", slug: join[1] ?? "" };
  switch (pathname) {
    case "/":
    case "/events":
      return { name: "events" };
    case "/signin":
      return { name: "signin" };
    case "/index-tables":
      return { name: "index-tables" };
    case "/season":
      return { name: "season" };
    case "/operator":
      return { name: "operator" };
    default:
      return { name: "unknown" };
  }
}

/** The current route from the address bar, and a navigate that pushes or replaces history. */
function useNavigationSource() {
  const [pathname, setPathname] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = (): void => setPathname(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const navigate = (to: string, replace = false): void => {
    if (replace) window.history.replaceState(null, "", to);
    else window.history.pushState(null, "", to);
    setPathname(window.location.pathname);
    window.scrollTo(0, 0);
  };
  return { route: parseRoute(pathname), navigate };
}

const NavigationContext = createContext<ReturnType<typeof useNavigationSource> | null>(null);

export function NavigationProvider({ children }: { children: React.ReactNode }) {
  return <NavigationContext.Provider value={useNavigationSource()}>{children}</NavigationContext.Provider>;
}

export function useNavigation(): ReturnType<typeof useNavigationSource> {
  const value = useContext(NavigationContext);
  if (!value) throw new Error("NavigationProvider is missing");
  return value;
}

export function Link({ href, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const { navigate } = useNavigation();
  const follow = (event: MouseEvent<HTMLAnchorElement>): void => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    navigate(href);
  };
  return <a href={href} onClick={follow} {...rest} />;
}
