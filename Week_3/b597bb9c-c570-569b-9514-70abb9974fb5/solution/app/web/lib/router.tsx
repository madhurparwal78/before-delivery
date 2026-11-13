import { useEffect, useState, useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from "react";

function subscribe(listener: () => void): () => void {
  window.addEventListener("popstate", listener);
  window.addEventListener("gatecut:navigate", listener);
  return () => {
    window.removeEventListener("popstate", listener);
    window.removeEventListener("gatecut:navigate", listener);
  };
}

const snapshot = (): string => window.location.pathname + window.location.search;

/** The current path and query, re-rendering on navigation. */
export function useLocation(): string {
  return useSyncExternalStore(subscribe, snapshot, () => "/");
}

export function navigate(to: string, replace = false): void {
  if (to === snapshot()) return;
  if (replace) window.history.replaceState(null, "", to);
  else window.history.pushState(null, "", to);
  window.dispatchEvent(new Event("gatecut:navigate"));
}

export function Link({ to, onClick, children, ...rest }: { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>): ReactNode {
  const go = (event: MouseEvent<HTMLAnchorElement>): void => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  };
  return (
    <a href={to} onClick={go} {...rest}>
      {children}
    </a>
  );
}

/** The project-page layout, decided by viewport width alone. */
function layoutFor(width: number): "review-list" | "two-pane" | "editor" {
  return width < 700 ? "review-list" : width < 1100 ? "two-pane" : "editor";
}

export function useLayout(): "review-list" | "two-pane" | "editor" {
  const [layout, setLayout] = useState(() => layoutFor(window.innerWidth));
  useEffect(() => {
    const update = (): void => setLayout(layoutFor(window.innerWidth));
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return layout;
}

