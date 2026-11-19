import { useEffect, useState } from "react";

const CHANGED = "nightroll:navigate";

/** Moves to a path without reloading the page. */
export function navigate(path: string): void {
  window.history.replaceState(null, "", path);
  window.dispatchEvent(new Event(CHANGED));
}

export function usePath(): string {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const update = (): void => setPath(window.location.pathname);
    window.addEventListener(CHANGED, update);
    window.addEventListener("popstate", update);
    return () => {
      window.removeEventListener(CHANGED, update);
      window.removeEventListener("popstate", update);
    };
  }, []);
  return path;
}
