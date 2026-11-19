// The address is the app's route: push and replace history entries, and follow Back and Forward.
import { useEffect, useState } from "react";

interface Location {
  path: string;
  search: string;
  /** Changes on every navigation, Back and Forward included. */
  stamp: number;
}

let stamp = 0;

function current(): Location {
  stamp += 1;
  return { path: window.location.pathname, search: window.location.search, stamp };
}

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  if (options.replace) window.history.replaceState(null, "", to);
  else window.history.pushState(null, "", to);
  notify();
}

export function useLocation(): Location {
  const [location, setLocation] = useState(current);
  useEffect(() => {
    const update = (): void => setLocation(current());
    listeners.add(update);
    window.addEventListener("popstate", update);
    return () => {
      listeners.delete(update);
      window.removeEventListener("popstate", update);
    };
  }, []);
  return location;
}
