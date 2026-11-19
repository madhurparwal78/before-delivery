// Tiny hash-free router. Workspace routes sit under /w/<workspaceId>/.

import { useEffect, useState } from "react";

export function usePath(): string {
  const [path, setPath] = useState(() => window.location.pathname + window.location.search);
  useEffect(() => {
    const onChange = () => setPath(window.location.pathname + window.location.search);
    window.addEventListener("popstate", onChange);
    return () => window.removeEventListener("popstate", onChange);
  }, []);
  return path;
}

export function navigate(path: string, replace = false): void {
  if (replace) {
    window.history.replaceState({}, "", path);
  } else {
    window.history.pushState({}, "", path);
  }
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function linkProps(path: string): {
  href: string;
  onClick: (event: React.MouseEvent<HTMLAnchorElement>) => void;
} {
  return {
    href: path,
    onClick: (event) => {
      if (event.metaKey || event.ctrlKey) return;
      event.preventDefault();
      navigate(path);
    },
  };
}
