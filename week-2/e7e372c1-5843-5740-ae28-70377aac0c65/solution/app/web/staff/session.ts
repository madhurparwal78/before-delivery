import { createContext, useContext } from "react";
import type { StaffUser } from "../../shared/domain.ts";

interface StaffContextValue {
  user: StaffUser;
  /** Replaces the signed-in person after a different user signs in at the sign-in dialog. */
  setUser: (user: StaffUser) => void;
}

export const StaffContext = createContext<StaffContextValue | null>(null);

export function useStaff(): StaffContextValue {
  const value = useContext(StaffContext);
  if (!value) throw new Error("staff context is missing");
  return value;
}

export function randomKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
