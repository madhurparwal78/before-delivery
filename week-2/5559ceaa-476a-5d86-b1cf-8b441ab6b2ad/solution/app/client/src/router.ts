import { useEffect, useState } from "react";

interface Place {
  path: string;
  query: URLSearchParams;
  state: unknown;
}

const read = (): Place => ({
  path: window.location.pathname,
  query: new URLSearchParams(window.location.search),
  state: window.history.state,
});

export function navigate(path: string, state: unknown = null): void {
  window.history.pushState(state, "", path);
  window.dispatchEvent(new PopStateEvent("popstate", { state }));
}

export function usePlace(): Place {
  const [place, setPlace] = useState(read);
  useEffect(() => {
    const update = () => setPlace(read());
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  return place;
}
