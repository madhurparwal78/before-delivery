// Client routing with the route wipe (brief: Motion → Route wipe): a stone panel (night on public drop pages) wipes
// up over the old page and away over 560 ms, downward on Back; when it ends focus moves to the new heading.
import { type MouseEvent, type ReactNode, createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { ENTRANCE, EASE, reducedMotion } from "./motion";

interface RouterState {
  path: string;
  search: string;
  navigate: (to: string, options?: { replace?: boolean }) => void;
}

const RouterContext = createContext<RouterState>({ path: "/", search: "", navigate: () => undefined });

export function useRouter(): RouterState {
  return useContext(RouterContext);
}

function focusHeading(): void {
  const heading = document.querySelector<HTMLElement>("main h1");
  heading?.focus({ preventScroll: false });
}

export function RouterProvider({ children }: { children: ReactNode }): JSX.Element {
  const [shown, setShown] = useState({ path: location.pathname, search: location.search });
  const wipe = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);

  const change = useCallback((path: string, search: string, direction: "up" | "down") => {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current = [];
    const samePage = path === location.pathname && path === shown.path;
    if (samePage || reducedMotion() || !wipe.current) {
      setShown({ path, search });
      if (!samePage) window.setTimeout(focusHeading, 0);
      return;
    }
    const night = /^\/drops\//.test(path) || /^\/drops\//.test(shown.path);
    wipe.current.dataset.tone = night ? "night" : "stone";
    const from = direction === "up" ? "100%" : "-100%";
    const to = direction === "up" ? "-100%" : "100%";
    const panel = wipe.current;
    panel.style.visibility = "visible";
    const run = panel.animate(
      [{ transform: `translateY(${from})` }, { transform: "translateY(0)", offset: 0.5 }, { transform: `translateY(${to})` }],
      { duration: ENTRANCE, easing: EASE },
    );
    run.finished.then(() => (panel.style.visibility = "hidden")).catch(() => undefined);
    timers.current.push(
      window.setTimeout(() => {
        setShown({ path, search });
        window.scrollTo({ top: 0, behavior: "instant" });
      }, ENTRANCE / 2),
      window.setTimeout(focusHeading, ENTRANCE),
    );
  }, [shown.path]);

  const navigate = useCallback(
    (to: string, options: { replace?: boolean } = {}) => {
      const url = new URL(to, location.origin);
      if (options.replace) history.replaceState(null, "", url);
      else history.pushState(null, "", url);
      change(url.pathname, url.search, "up");
    },
    [change],
  );

  useEffect(() => {
    const onPop = (): void => change(location.pathname, location.search, "down");
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [change]);

  return (
    <RouterContext.Provider value={{ path: shown.path, search: shown.search, navigate }}>
      {children}
      <div ref={wipe} className="route-wipe" aria-hidden="true" />
    </RouterContext.Provider>
  );
}

export function Link({ to, children, className, ...rest }: { to: string; children: ReactNode; className?: string } & Omit<JSX.IntrinsicElements["a"], "href">): JSX.Element {
  const { navigate } = useRouter();
  const onClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    rest.onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  };
  return (
    <a {...rest} href={to} className={className} onClick={onClick}>
      {children}
    </a>
  );
}

/** Matches a path against a pattern like `/studio/drops/:id`; returns the parameters or null. */
export function match(pattern: string, path: string): Record<string, string> | null {
  const keys: string[] = [];
  const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k: string) => (keys.push(k), "([^/]+)"))}$`);
  const m = re.exec(path);
  if (!m) return null;
  return Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
}
