import { createContext, useContext, useEffect, useRef, useState } from "react";
import { call } from "./api";
import type { Kitchen, ServiceStatus, User } from "./types";

// The signed-in user, their kitchen and the service status, shared by every screen.

export interface Session {
  user: User;
  kitchen: Kitchen;
  /** Server clock minus device clock, so countdowns and windows follow the server. */
  clockOffset: number;
}

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession outside a signed-in screen");
  return session;
}

const SERVICE_NAMES = { billing: "Billing", files: "File storage", mail: "Email" } as const;
type ServiceKey = keyof typeof SERVICE_NAMES;
const SERVICE_KEYS: ServiceKey[] = ["billing", "files", "mail"];

const OUTAGE_COPY: Record<ServiceKey, string> = {
  billing: "Billing is unreachable. Confirming, cancelling, recurring slots and pack purchases are paused. Brushing and holds still work.",
  files: "File storage is unreachable. Uploading and opening documents are paused. Bookings still use the papers on file.",
  mail: "Email is unreachable. Confirming, cancelling and recurring slots are paused.",
};

interface Services {
  paused: Set<string>;
  lines: string[];
}

export const ServicesContext = createContext<Services>({ paused: new Set(), lines: [] });

export const usePaused = (action: string): boolean => useContext(ServicesContext).paused.has(action);

/** Polls GET /api/status every 10 seconds; a recovered service is announced for 10 seconds. */
export function useServiceStatus(): Services {
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const [recovered, setRecovered] = useState<{ service: ServiceKey; until: number }[]>([]);
  const previous = useRef<ServiceStatus | null>(null);

  useEffect(() => {
    let alive = true;
    const poll = async (): Promise<void> => {
      const result = await call<ServiceStatus>("GET", "/api/status");
      if (!alive || !result.ok) return;
      const before = previous.current;
      if (before) {
        const back = SERVICE_KEYS.filter(
          (s) => before.services[s] === "down" && result.data.services[s] === "up",
        );
        if (back.length > 0) setRecovered((list) => [...list.filter((r) => !back.includes(r.service)), ...back.map((service) => ({ service, until: Date.now() + 10_000 }))]);
      }
      previous.current = result.data;
      setStatus(result.data);
      setRecovered((list) => list.filter((r) => r.until > Date.now()));
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 10_000);
    const expire = window.setInterval(() => setRecovered((list) => (list.some((r) => r.until <= Date.now()) ? list.filter((r) => r.until > Date.now()) : list)), 1_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.clearInterval(expire);
    };
  }, []);

  const lines: string[] = [];
  if (status) {
    for (const service of SERVICE_KEYS) {
      if (status.services[service] === "down") lines.push(OUTAGE_COPY[service]);
    }
  }
  for (const r of recovered) lines.push(`${SERVICE_NAMES[r.service]} is back. Paused actions are available again.`);
  return { paused: new Set(status?.paused ?? []), lines };
}
