import { useEffect, useState } from "react";
import { api } from "./api.js";
import type { ServiceStatus } from "./types.js";

const STATUS_INTERVAL_MS = 10_000;

/**
 * Polls the service status. The returned value changes only when a service
 * changes state, so a check never disturbs open dialogs, focus or typed values.
 */
export function useServiceStatus(): { storage: "ok" | "unreachable"; ticks: number } {
  const [storage, setStorage] = useState<"ok" | "unreachable">("ok");
  const [ticks, setTicks] = useState(0);

  useEffect(() => {
    let live = true;
    const check = async (): Promise<void> => {
      try {
        const status = await api<ServiceStatus>("GET", "/api/status");
        if (!live) return;
        setStorage(status.storage);
        setTicks((value) => value + 1);
      } catch {
        /* A failed check leaves the last known state in place. */
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), STATUS_INTERVAL_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, []);

  return { storage, ticks };
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (): void => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

export type Layout = "phone" | "tablet" | "desktop";

export function useLayout(): Layout {
  const [layout, setLayout] = useState<Layout>(() => layoutFor(window.innerWidth));
  useEffect(() => {
    const onResize = (): void => setLayout(layoutFor(window.innerWidth));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return layout;
}

function layoutFor(width: number): Layout {
  if (width < 768) return "phone";
  if (width < 1024) return "tablet";
  return "desktop";
}
