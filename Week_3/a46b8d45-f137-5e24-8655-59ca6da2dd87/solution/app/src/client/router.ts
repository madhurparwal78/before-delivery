import { createStore, useStore } from "./store";

const location = createStore(window.location.pathname);

window.addEventListener("popstate", () => location.set(window.location.pathname));

export function navigate(path: string, replace = false): void {
  if (path === window.location.pathname) return;
  if (replace) window.history.replaceState(null, "", path);
  else window.history.pushState(null, "", path);
  location.set(path);
}

export const usePath = (): string => useStore(location);

/** Same-origin links navigate without a page load; modified clicks keep their browser meaning. */
export function onLinkClick(event: MouseEvent, path: string): void {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  navigate(path);
}
