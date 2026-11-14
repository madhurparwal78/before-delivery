import type { ComponentChildren } from "preact";
import { Store, useStore } from "./store.ts";

const location = new Store({ path: window.location.pathname, search: window.location.search });

window.addEventListener("popstate", () => location.set({ path: window.location.pathname, search: window.location.search }));

export function navigate(to: string, replace = false): void {
  const url = new URL(to, window.location.origin);
  if (replace) window.history.replaceState(null, "", url);
  else window.history.pushState(null, "", url);
  location.set({ path: url.pathname, search: url.search });
}

export const useLocation = (): { path: string; search: string } => useStore(location);

interface LinkProps {
  href: string;
  children: ComponentChildren;
  class?: string;
  "aria-label"?: string;
}

/** An anchor that navigates in the page, so a pushed update is never lost to a reload. */
export function Link(props: LinkProps) {
  return (
    <a
      {...props}
      onClick={(event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigate(props.href);
      }}
    />
  );
}
