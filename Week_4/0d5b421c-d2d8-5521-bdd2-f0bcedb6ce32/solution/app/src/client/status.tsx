// Dependency status: checked on page load and every 30 seconds; a 503 from an action shows its banner at once.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { StatusResponse } from "../shared/api.js";
import { get, onOutage } from "./api.js";

interface DependencyStatus {
  holdsPaused: boolean;
  depositsPaused: boolean;
  /** Counts status checks, so pages can refresh on each one while live updates are paused. */
  checks: number;
}

const StatusContext = createContext<DependencyStatus>({ holdsPaused: false, depositsPaused: false, checks: 0 });

const CHECK_MS = 30_000;

export function StatusProvider({ children }: { children: ReactNode }) {
  const [holdsPaused, setHoldsPaused] = useState(false);
  const [depositsPaused, setDepositsPaused] = useState(false);
  const [checks, setChecks] = useState(0);

  useEffect(() => {
    let live = true;
    const check = async (): Promise<void> => {
      const outcome = await get<StatusResponse>("/api/status");
      if (!live || !outcome.ok) return;
      setHoldsPaused(outcome.body.holds === "paused");
      setDepositsPaused(outcome.body.deposits === "paused");
      setChecks((count) => count + 1);
    };
    void check();
    const timer = window.setInterval(() => void check(), CHECK_MS);
    const stopListening = onOutage((dependency) => {
      if (dependency === "holds") setHoldsPaused(true);
      else setDepositsPaused(true);
    });
    return () => {
      live = false;
      window.clearInterval(timer);
      stopListening();
    };
  }, []);

  const value = useMemo(() => ({ holdsPaused, depositsPaused, checks }), [holdsPaused, depositsPaused, checks]);
  return <StatusContext.Provider value={value}>{children}</StatusContext.Provider>;
}

export function useDependencyStatus(): DependencyStatus {
  return useContext(StatusContext);
}
