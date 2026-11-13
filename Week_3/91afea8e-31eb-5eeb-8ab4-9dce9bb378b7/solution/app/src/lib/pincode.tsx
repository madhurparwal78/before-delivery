import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiFailure, get, put } from "./api";
import { useAuth } from "./auth";

export interface PincodeInfo {
  pincode: string;
  city: string | null;
  state: string | null;
  serviceable: boolean;
  cod_available: boolean;
}

interface PincodeValue {
  pin: string | null;
  info: PincodeInfo | null;
  /** Checks a pincode with the server and makes it the shopper's pincode everywhere. */
  check: (pincode: string) => Promise<PincodeInfo>;
}

const KEY = "chauraha.pincode";

/** Fired after the server-side destination changed, so the cart repaints its quote. */
export const DESTINATION_CHANGED = "chauraha:destination";
const PincodeContext = createContext<PincodeValue | null>(null);

export function usePincode(): PincodeValue {
  const value = useContext(PincodeContext);
  if (!value) throw new Error("PincodeProvider is missing");
  return value;
}

export function PincodeProvider({ children }: { children: ReactNode }): ReactNode {
  const [pin, setPin] = useState<string | null>(() => window.localStorage.getItem(KEY));
  const [info, setInfo] = useState<PincodeInfo | null>(null);
  const auth = useAuth();

  useEffect(() => {
    if (!pin) return;
    get<PincodeInfo>(`/api/pincodes/${pin}`).then(setInfo, (error: unknown) => {
      if (!(error instanceof ApiFailure)) throw error;
    });
  }, []);

  const check = useCallback(
    async (pincode: string): Promise<PincodeInfo> => {
      const found = await get<PincodeInfo>(`/api/pincodes/${pincode}`);
      window.localStorage.setItem(KEY, pincode);
      setPin(pincode);
      setInfo(found);
      if (auth.account?.role === "shopper") {
        await put("/api/cart/destination", { pincode });
        window.dispatchEvent(new Event(DESTINATION_CHANGED));
      }
      return found;
    },
    [auth.account],
  );

  const value = useMemo(() => ({ pin, info, check }), [pin, info, check]);
  return <PincodeContext.Provider value={value}>{children}</PincodeContext.Provider>;
}
