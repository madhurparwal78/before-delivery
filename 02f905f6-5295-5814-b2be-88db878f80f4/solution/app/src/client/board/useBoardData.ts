// Board data: kilns, each kiln's current firing, the queue and clays, refreshed every five seconds and
// right after the user's own actions. A refresh only replaces data, never what the user is doing.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Clay, Firing, Kiln, Piece } from "../../shared/api";
import { request } from "../api";

const REFRESH_MS = 5000;
const TRANSITION_PAD_MS = 150;

/** Milliseconds until the server's own next status change of a started firing, from server fields only. */
function untilNextChange(firing: Firing | null): number | null {
  if (!firing) return null;
  const at = firing.status === "firing" ? firing.firing_ends_at : firing.status === "cooling" ? firing.cool_until : null;
  if (!at) return null;
  return Math.max(0, Date.parse(at) - Date.parse(firing.server_now));
}

interface BoardData {
  kilns: Kiln[];
  firings: Record<string, Firing | null>;
  queue: Piece[];
  clays: Clay[];
  loaded: boolean;
  stale: boolean;
}

export function useBoardData() {
  const [data, setData] = useState<BoardData>({ kilns: [], firings: {}, queue: [], clays: [], loaded: false, stale: false });
  const running = useRef(false);
  const transition = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      const [kilns, queue, clays] = await Promise.all([request<Kiln[]>("GET", "/api/kilns"), request<Piece[]>("GET", "/api/queue"), request<Clay[]>("GET", "/api/clays")]);
      if (!kilns.ok || !queue.ok) {
        setData((current) => ({ ...current, stale: true }));
        return;
      }
      const firings: Record<string, Firing | null> = {};
      let failed = false;
      await Promise.all(
        kilns.data.map(async (kiln) => {
          if (kiln.current_firing_id === null) {
            firings[kiln.id] = null;
            return;
          }
          const firing = await request<Firing>("GET", `/api/firings/${kiln.current_firing_id}`);
          if (firing.ok) firings[kiln.id] = firing.data;
          else failed = true;
        }),
      );
      // Besides the five-second refresh, ask again just after the server's next scheduled status change, so
      // the board shows cooling and unloadable as soon as the server reports them.
      if (transition.current) clearTimeout(transition.current);
      transition.current = null;
      const next = Object.values(firings).map(untilNextChange).filter((ms): ms is number => ms !== null);
      if (next.length && Math.min(...next) < REFRESH_MS) {
        transition.current = setTimeout(() => void refresh(), Math.min(...next) + TRANSITION_PAD_MS);
      }
      setData((current) =>
        failed
          ? { ...current, stale: true }
          : { kilns: kilns.data, firings, queue: queue.data, clays: clays.ok ? clays.data : current.clays, loaded: true, stale: false },
      );
    } finally {
      running.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => {
      clearInterval(timer);
      if (transition.current) clearTimeout(transition.current);
    };
  }, [refresh]);

  return { data, setData, refresh };
}
