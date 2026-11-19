import { createContext, useContext, useState, type ReactNode } from "react";
import type { Account } from "../../shared/api.js";

interface Session {
  /** null when signed out. */
  account: Account | null;
  setAccount: (account: Account | null) => void;
}

const SessionContext = createContext<Session>({ account: null, setAccount: () => undefined });

/** The account the server put in the page with the HTML (null when signed out). */
function initialAccount(): Account | null {
  const text = document.getElementById("rushes-session")?.textContent;
  return text ? (JSON.parse(text) as Account | null) : null;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(initialAccount);
  return <SessionContext.Provider value={{ account, setAccount }}>{children}</SessionContext.Provider>;
}

export const useSession = (): Session => useContext(SessionContext);
