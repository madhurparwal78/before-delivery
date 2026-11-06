import { useEffect, useState } from "react";

export function usePath(): string {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const update = (): void => setPath(window.location.pathname);
    window.addEventListener("popstate", update);
    window.addEventListener("tracewell:navigate", update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener("tracewell:navigate", update);
    };
  }, []);
  return path;
}

export function navigate(path: string, replace = false): void {
  if (replace) window.history.replaceState(null, "", path);
  else window.history.pushState(null, "", path);
  window.dispatchEvent(new Event("tracewell:navigate"));
}
