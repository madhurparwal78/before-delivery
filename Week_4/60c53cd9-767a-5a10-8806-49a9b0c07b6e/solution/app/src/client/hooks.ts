/** Small shared hooks: the viewport class, and re-reads on a timer and when the window regains focus. */
import { useEffect, useRef, useState } from "react";

type Layout = "phone" | "tablet" | "desktop";

const layoutFor = (width: number): Layout => (width < 768 ? "phone" : width < 1100 ? "tablet" : "desktop");

export const useLayout = (): Layout => {
  const [layout, setLayout] = useState<Layout>(() => layoutFor(window.innerWidth));
  useEffect(() => {
    const update = (): void => setLayout(layoutFor(window.innerWidth));
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return layout;
};

const REREAD_MS = 5_000;

/** Calls `read` every five seconds and whenever the window regains focus or becomes visible. */
export const useReread = (read: () => void, active = true): void => {
  const latest = useRef(read);
  latest.current = read;
  useEffect(() => {
    if (!active) return undefined;
    const run = (): void => latest.current();
    const interval = window.setInterval(run, REREAD_MS);
    const onVisible = (): void => {
      if (document.visibilityState === "visible") run();
    };
    window.addEventListener("focus", run);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", run);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active]);
};
