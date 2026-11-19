import { createContext, useContext, useState, type ReactNode } from "react";
import type { User } from "../shared/api";

interface NoticeState {
  user: User;
  notice: string;
  setNotice: (text: string) => void;
  closeStatus: string;
  setCloseStatus: (text: string) => void;
}

const Context = createContext<NoticeState | null>(null);

/** The signed-in user and the two messages that stay until the next message for their region. */
export function SessionProvider({ user, children }: { user: User; children: ReactNode }) {
  const [notice, setNotice] = useState("");
  const [closeStatus, setCloseStatus] = useState("");
  return <Context.Provider value={{ user, notice, setNotice, closeStatus, setCloseStatus }}>{children}</Context.Provider>;
}

export function useSession(): NoticeState {
  const value = useContext(Context);
  if (!value) throw new Error("useSession outside SessionProvider");
  return value;
}
