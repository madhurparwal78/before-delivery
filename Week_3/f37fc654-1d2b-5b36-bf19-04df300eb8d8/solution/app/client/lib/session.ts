// Who is signed in, and the in-place signed-out state after a failed refresh.
import { useEffect } from "react";
import { call, onSessionEnded } from "./api";
import { store } from "./store";

export type Role = "producer" | "client" | "sponsor" | "crew";

export interface Me {
  id: string;
  email: string;
  name: string;
  roles: Role[];
}

const session = store<{ status: "loading" | "in" | "out"; me: Me | null; ended: boolean }>({ status: "loading", me: null, ended: false });

let loading: Promise<void> | null = null;

/** Reads who is signed in, once however many components ask at the same time. */
function loadMe(): Promise<void> {
  loading ??= call<Me>("/api/me").then(
    (me) => session.set({ status: "in", me, ended: false }),
    () => session.set({ status: "out", me: null }),
  ).finally(() => {
    loading = null;
  });
  return loading;
}

onSessionEnded(() => session.set({ ended: true }));

export function useSession(): ReturnType<typeof session.get> {
  const value = session.use();
  useEffect(() => {
    if (value.status === "loading") void loadMe();
  }, [value.status]);
  return value;
}

export const hasRole = (me: Me | null, role: Role): boolean => Boolean(me?.roles.includes(role));
