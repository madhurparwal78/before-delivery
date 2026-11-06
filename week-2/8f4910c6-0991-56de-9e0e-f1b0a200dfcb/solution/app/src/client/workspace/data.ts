// Shared workspace helpers: the signed-in member, loading a resource, and the outage copies.

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { useSession, sessionCopy, type Member } from "../session.js";

export const BILLING_DOWN = "Billing is unreachable, so nothing was saved. Try again in a few minutes.";
export const STORAGE_DOWN = "Photo storage is unreachable, so nothing was saved. Try again in a few minutes.";

/** The signed-in member; workspace pages render only inside the workspace guard, which waits for one. */
export function useMember(): Member {
  const { member } = useSession();
  if (!member) throw new Error("workspace page rendered without a member");
  return member;
}

/** The copy a failed call announces when nothing more specific applies. */
export function failureCopy(error: { error: string }): string {
  if (error.error === "storage_unavailable") return STORAGE_DOWN;
  if (error.error === "billing_unavailable") return BILLING_DOWN;
  return sessionCopy(error) ?? "That did not go through. Reload the page and try again.";
}

/** Loads `path` once and on `reload()`; `data` stays null until the first answer. */
export function useResource<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  const current = useRef(path);
  current.current = path;
  const reload = useCallback(async (): Promise<T | null> => {
    const wanted = current.current;
    if (!wanted) return null;
    const result = await api<T>("GET", wanted);
    if (current.current !== wanted) return null;
    if (result.ok) {
      setData(result.data);
      setFailed(false);
      return result.data;
    }
    setFailed(true);
    return null;
  }, []);
  useEffect(() => {
    setData(null);
    void reload();
  }, [path, reload]);
  return { data, failed, reload, setData };
}
