// In-page navigation on the History API. Every screen reads the address bar; nothing else holds route state.
import { useEffect, useState } from "preact/hooks";

const NAVIGATED = "farshore:navigate";

export interface Place {
  path: string;
  search: URLSearchParams;
  href: string;
}

function here(): Place {
  return { path: location.pathname, search: new URLSearchParams(location.search), href: location.pathname + location.search };
}

export function navigate(href: string, replace = false): void {
  if (replace) history.replaceState(null, "", href);
  else history.pushState(null, "", href);
  dispatchEvent(new Event(NAVIGATED));
}

export function usePlace(): Place {
  const [place, setPlace] = useState(here);
  useEffect(() => {
    const update = (): void => setPlace(here());
    addEventListener("popstate", update);
    addEventListener(NAVIGATED, update);
    return () => {
      removeEventListener("popstate", update);
      removeEventListener(NAVIGATED, update);
    };
  }, []);
  return place;
}

// Plain left clicks on in-app links push history instead of reloading the page.
export function follow(event: MouseEvent, href: string): void {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  navigate(href);
}
