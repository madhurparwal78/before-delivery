import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useConfig } from "./config";

interface Line {
  key: number;
  text: string;
}

interface StatusValue {
  announce: (message: string) => void;
}

const StatusContext = createContext<StatusValue | null>(null);
const MAX_LINES = 3;

/** The one polite Status region of the page: up to three newest messages, each removed after the toast time. */
export function StatusProvider({ children }: { children: ReactNode }) {
  const { toastMs } = useConfig();
  const [lines, setLines] = useState<Line[]>([]);
  const counter = useRef(0);
  const timers = useRef(new Map<number, number>());

  const announce = useCallback((message: string) => {
    counter.current += 1;
    const key = counter.current;
    setLines((current) => [...current, { key, text: message }].slice(-MAX_LINES));
    timers.current.set(key, window.setTimeout(() => {
      timers.current.delete(key);
      setLines((current) => current.filter((line) => line.key !== key));
    }, toastMs));
  }, [toastMs]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => window.clearTimeout(timer));
  }, []);

  const value = useMemo(() => ({ announce }), [announce]);
  return (
    <StatusContext.Provider value={value}>
      {children}
      {createPortal(
        <div className="status-region" role="status" aria-label="Status" aria-live="polite" aria-atomic="false">
          {lines.map((line) => <p className="status-line" key={line.key}>{line.text}</p>)}
        </div>,
        document.body,
      )}
    </StatusContext.Provider>
  );
}

export function useStatus(): StatusValue {
  const value = useContext(StatusContext);
  if (!value) throw new Error("useStatus outside StatusProvider");
  return value;
}
