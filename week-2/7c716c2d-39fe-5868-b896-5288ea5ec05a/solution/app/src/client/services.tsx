// Service status for the notices: read on load, every 10 seconds, after any 503 and on a
// `notice` event. Shared by signed-out and signed-in screens.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { get, type ServiceStatus } from "./api";

interface Services {
  status: ServiceStatus | null;
  refresh: () => void;
}

const Context = createContext<Services>({ status: null, refresh: () => undefined });

export function useServices(): Services {
  return useContext(Context);
}

export function ServicesProvider(props: { children: ReactNode; refreshRef: (refresh: () => void) => void }): JSX.Element {
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const refresh = useCallback(() => {
    get<ServiceStatus>("/api/status")
      .then((next) => setStatus((prev) => (prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next)))
      .catch(() => undefined);
  }, []);
  props.refreshRef(refresh);
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 10_000);
    return () => clearInterval(timer);
  }, [refresh]);
  return <Context.Provider value={{ status, refresh }}>{props.children}</Context.Provider>;
}

export const DB_NOTICE = "Tallyroom can't reach its database. Changes are not being saved.";
export const STORAGE_NOTICE = "Attachments are unavailable right now. Nothing new can be attached.";

export function mailNotice(held: number): string {
  return held === 1 ? "Mail delayed: 1 message waiting to send." : `Mail delayed: ${held} messages waiting to send.`;
}
