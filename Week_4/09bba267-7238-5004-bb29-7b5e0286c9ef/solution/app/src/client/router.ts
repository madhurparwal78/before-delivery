// In-page navigation: the address is the state; links push, the seat map replaces its own query.
import { useEffect, useState } from "preact/hooks";

const subscribers = new Set<() => void>();

export function navigate(to: string): void {
  history.pushState(null, "", to);
  window.scrollTo({ top: 0, behavior: "instant" });
  subscribers.forEach((notify) => notify());
}

/** The current path; re-renders on navigate() and on Back / Forward. */
export function usePath(): string {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const update = (): void => setPath(location.pathname);
    subscribers.add(update);
    window.addEventListener("popstate", update);
    return () => {
      subscribers.delete(update);
      window.removeEventListener("popstate", update);
    };
  }, []);
  return path;
}

/** Click handler for same-origin links: plain left clicks navigate in the page. */
export function follow(event: MouseEvent): void {
  const anchor = event.currentTarget as HTMLAnchorElement;
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  navigate(anchor.getAttribute("href") ?? "/");
}
