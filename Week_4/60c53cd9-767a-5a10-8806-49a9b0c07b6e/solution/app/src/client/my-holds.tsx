/** The signed-in buyer's own holds, re-read every five seconds, shared by the header link and the finder. */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PublicHold } from "../shared/api-types.js";
import { api, NetworkError } from "./api.js";
import { useAuth } from "./auth.js";
import { useReread } from "./hooks.js";

interface MyHolds {
  readonly holds: readonly PublicHold[];
  /** The buyer's active hold, if any. */
  readonly active: PublicHold | null;
  readonly refresh: () => void;
  /** A hold the server just confirmed. */
  readonly add: (hold: PublicHold) => void;
}

const MyHoldsContext = createContext<MyHolds>({ holds: [], active: null, refresh: () => undefined, add: () => undefined });

export const useMyHolds = (): MyHolds => useContext(MyHoldsContext);

export const MyHoldsProvider = ({ children }: { children: ReactNode }): ReactNode => {
  const { account, sessionLost } = useAuth();
  const [holds, setHolds] = useState<readonly PublicHold[]>([]);
  const sequence = useRef(0);
  const isBuyer = account?.role === "buyer";

  const refresh = useCallback(() => {
    if (!isBuyer) return;
    sequence.current += 1;
    const mine = sequence.current;
    void api<{ holds: PublicHold[] }>("GET", "/api/holds")
      .then((result) => {
        if (mine !== sequence.current) return;
        if (result.status === 401) sessionLost();
        else if (result.ok) setHolds(result.body.holds);
      })
      .catch((error: unknown) => {
        if (!(error instanceof NetworkError)) throw error;
      });
  }, [isBuyer, sessionLost]);

  useEffect(() => {
    if (isBuyer) refresh();
    else setHolds([]);
  }, [isBuyer, refresh]);

  useReread(refresh, isBuyer);

  const add = useCallback((hold: PublicHold) => {
    sequence.current += 1;
    setHolds((previous) => [hold, ...previous.filter((existing) => existing.id !== hold.id)]);
  }, []);

  const value = useMemo<MyHolds>(
    () => ({ holds, active: holds.find((hold) => hold.status === "active") ?? null, refresh, add }),
    [holds, refresh, add],
  );
  return <MyHoldsContext.Provider value={value}>{children}</MyHoldsContext.Provider>;
};
