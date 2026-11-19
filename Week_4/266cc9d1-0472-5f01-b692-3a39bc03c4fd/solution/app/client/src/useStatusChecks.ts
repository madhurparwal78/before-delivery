// The status check: GET /api/status when the page loads and every 10 seconds after. Each check
// reports the new state and the storage state before it; nothing on the page is reset by a check.
import { useEffect, useRef, useState } from "react";
import { api, type ServiceStatus } from "./api";

const STATUS_INTERVAL_MS = 10_000;

export function useStatusChecks(onCheck: (now: ServiceStatus, previousStorage: ServiceStatus["storage"] | null) => void): { storage: ServiceStatus["storage"] | null } {
  const [storage, setStorage] = useState<ServiceStatus["storage"] | null>(null);
  const previous = useRef<ServiceStatus["storage"] | null>(null);
  const handler = useRef(onCheck);
  handler.current = onCheck;
  useEffect(() => {
    const check = () =>
      api<ServiceStatus>("GET", "/api/status")
        .then((now) => {
          const before = previous.current;
          previous.current = now.storage;
          setStorage(now.storage);
          handler.current(now, before);
        })
        .catch(() => undefined);
    void check();
    const timer = window.setInterval(() => void check(), STATUS_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);
  return { storage };
}
