import { useCallback, useEffect, useState } from "react";

export interface Place {
  pathname: string;
  search: string;
}

export type Cause = "load" | "push" | "replace" | "pop";

const read = (): Place => ({ pathname: window.location.pathname, search: window.location.search });

/** The address bar as state: pushState and replaceState are explicit, and Back and Forward come through popstate. */
export function useAddress(): { place: Place; cause: Cause; go: (to: string, mode: "push" | "replace") => void } {
  const [place, setPlace] = useState<Place>(read);
  const [cause, setCause] = useState<Cause>("load");
  useEffect(() => {
    const onPop = () => {
      setCause("pop");
      setPlace(read());
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const go = useCallback((to: string, mode: "push" | "replace") => {
    if (mode === "push") window.history.pushState(null, "", to);
    else window.history.replaceState(null, "", to);
    setCause(mode);
    setPlace(read());
  }, []);
  return { place, cause, go };
}
