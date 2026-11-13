// Service status: read on load and every 30 seconds. Each check (and each return to the tab)
// also asks the screen to re-read its data in place.

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { ServiceStatus } from "../shared/api";
import { get } from "./api";

const STATUS_CHECK_MS = 30_000;

interface StatusValue {
  status: ServiceStatus | null;
  /** Increments on every status check and every return to the tab. */
  refresh: number;
  /** Increments when a status answer arrives (the latest storage word may have changed). */
  checked: number;
}

const StatusContext = createContext<StatusValue>({ status: null, refresh: 0, checked: 0 });

export function StatusProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<StatusValue>({ status: null, refresh: 0, checked: 0 });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const check = async (): Promise<void> => {
      const answer = await get<ServiceStatus>("/api/status");
      if (alive.current && answer.ok) setValue((v) => ({ ...v, status: answer.data, checked: v.checked + 1 }));
    };
    const tick = (): void => {
      setValue((v) => ({ ...v, refresh: v.refresh + 1 }));
      void check();
    };
    void check();
    const timer = setInterval(tick, STATUS_CHECK_MS);
    const onVisible = (): void => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive.current = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return <StatusContext.Provider value={value}>{children}</StatusContext.Provider>;
}

export const useStatus = (): StatusValue => useContext(StatusContext);

export const STORE_OUTAGE =
  "The score store is offline. Scans can't be uploaded or opened right now. Catalogue, counts and cuts still work.";
export const MAIL_OUTAGE = "Mail is offline. Notices are queued and will be sent when it's back.";
export const STORE_OUTAGE_ID = "store-outage-description";
