import { createContext, useContext } from "react";
import type { Me, Person } from "../shared/types.js";

type SessionValue = {
  person: Person;
  serverDate: string;
  refresh: () => Promise<Me>;
};

export const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession outside a signed-in page");
  return value;
}
