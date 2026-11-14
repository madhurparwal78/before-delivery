import { useLayoutEffect, useState } from "preact/hooks";
import { api, ApiFailure } from "./api.ts";
import { Store, useStore } from "./store.ts";

interface Me {
  id: string;
  name: string;
  email: string;
  reduceMotion: boolean;
  school: { id: string; name: string } | null;
  classes: { id: string; name: string }[];
  role: "instructor" | "student" | null;
}

export const meStore = new Store<{ loaded: boolean; me: Me | null }>({ loaded: false, me: null });

export async function loadMe(): Promise<void> {
  try {
    meStore.set({ loaded: true, me: await api<Me>("GET", "/api/me") });
  } catch (error) {
    if (!(error instanceof ApiFailure)) throw error;
    meStore.set({ loaded: true, me: null });
  }
}

export const useMe = (): { loaded: boolean; me: Me | null } => useStore(meStore);

const systemQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

/** Reduced motion applies under the system setting or the `Reduce motion` setting. */
export function useReducedMotion(): boolean {
  const { me } = useMe();
  const [system, setSystem] = useState(systemQuery.matches);
  useLayoutEffect(() => {
    const listener = (): void => setSystem(systemQuery.matches);
    systemQuery.addEventListener("change", listener);
    return () => systemQuery.removeEventListener("change", listener);
  }, []);
  return system || (me?.reduceMotion ?? false);
}
