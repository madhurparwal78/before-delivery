// The signed-in member, read from /api/auth/session.
import { type ReactNode, createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "./api";

export type Role = "launch_producer" | "merchandiser" | "finance_lead" | "press_lead" | "stockist_buyer";

export interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
  stockistId: string | null;
  createdAt: string;
}

interface Session {
  member: Member | null;
  workspace: { id: string; name: string } | null;
  loaded: boolean;
  refresh: () => Promise<Member | null>;
  clear: () => void;
}

const SessionContext = createContext<Session>({ member: null, workspace: null, loaded: false, refresh: async () => null, clear: () => undefined });

export const ROLE_HOME: Record<Role, string> = {
  launch_producer: "/studio/drops",
  merchandiser: "/studio/drops",
  finance_lead: "/studio/invoicing",
  press_lead: "/studio/press",
  stockist_buyer: "/studio/my-store",
};

// The staff screens each role may use: those in its navigation and those opened from them (brief: sign-in `next`).
const ROLE_SCREENS: Record<Role, string[]> = {
  launch_producer: ["drops", "drops/new", "drops/:id", "drops/:id/allocations", "allocations/:id", "stockists", "stockists/:id", "members"],
  merchandiser: ["drops", "drops/:id/allocations", "drops/:id/line-sheet", "drops/:id/lookbook", "allocations/:id", "stockists", "stockists/:id", "price-lists"],
  finance_lead: ["invoicing", "drops/:id/allocations", "allocations/:id", "price-lists", "stockists", "stockists/:id"],
  press_lead: ["press", "drops/:id/story", "drops/:id/previews"],
  stockist_buyer: ["my-store"],
};

export function mayOpen(role: Role, path: string): boolean {
  return ROLE_SCREENS[role].some((screen) => {
    const pattern = screen.split("/").map((part) => (part === ":id" ? "(?!new$)[^/]+" : part)).join("/");
    return new RegExp(`^/studio/${pattern}$`).test(path);
  });
}

export const ROLE_LABEL: Record<Role, string> = {
  launch_producer: "Launch producer",
  merchandiser: "Merchandiser",
  finance_lead: "Finance lead",
  press_lead: "Press lead",
  stockist_buyer: "Stockist buyer",
};

export function SessionProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, setState] = useState<Omit<Session, "refresh" | "clear">>({ member: null, workspace: null, loaded: false });
  const refresh = useCallback(async () => {
    const r = await api<{ member: Member; workspace: { id: string; name: string } }>("GET", "/api/auth/session");
    if (r.ok) setState({ member: r.data.member, workspace: r.data.workspace, loaded: true });
    else setState({ member: null, workspace: null, loaded: true });
    return r.ok ? r.data.member : null;
  }, []);
  const clear = useCallback(() => setState({ member: null, workspace: null, loaded: true }), []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return <SessionContext.Provider value={{ ...state, refresh, clear }}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  return useContext(SessionContext);
}
