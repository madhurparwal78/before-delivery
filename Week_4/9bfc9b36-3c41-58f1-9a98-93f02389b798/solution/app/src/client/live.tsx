/** The polite status region, the single alert region and the store-outage banner: one set for the whole app. */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { setOutageHandler } from "./api.js";

interface LiveValue {
  say: (text: string) => void;
  refuse: (text: string | null) => void;
  alertText: string | null;
  outage: string | null;
  setOutage: (copy: string | null) => void;
  statusRef: React.RefObject<HTMLDivElement | null>;
}

const LiveContext = createContext<LiveValue | null>(null);

export function Live({ children }: { children: ReactNode }) {
  const statusRef = useRef<HTMLDivElement>(null);
  const [alertText, setAlertText] = useState<string | null>(null);
  const [outage, setOutage] = useState<string | null>(null);
  const say = useCallback((text: string) => {
    const region = statusRef.current;
    if (!region) return;
    region.textContent = "";
    region.textContent = text;
  }, []);
  const refuse = useCallback((text: string | null) => setAlertText(text), []);
  useEffect(() => {
    setOutageHandler(setOutage);
  }, []);
  const value = useMemo(() => ({ say, refuse, alertText, outage, setOutage, statusRef }), [say, refuse, alertText, outage]);
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive(): LiveValue {
  const value = useContext(LiveContext);
  if (!value) throw new Error("Live regions are missing");
  return value;
}

/** Rendered once at the top of the app so the same elements serve every screen. */
export function LiveRegions({ reserved }: { reserved: boolean }) {
  const { statusRef, alertText, outage } = useLive();
  return (
    <div className={reserved ? "live-regions reserved" : "live-regions"}>
      <div ref={statusRef} role="status" aria-label="Loft status" aria-live="polite" className="status-line" />
      <div role="alert" className={alertText ? "alert-field has-copy" : "alert-field"}>
        {alertText}
      </div>
      {outage ? (
        <section aria-label="Store outage" className="outage-banner">
          {outage}
        </section>
      ) : null}
    </div>
  );
}
