import { useSyncExternalStore } from "react";
import type { MeResponse } from "../../shared/types";
import { get } from "./api";

interface Boot {
  me: MeResponse | null;
}

const boot = JSON.parse(document.getElementById("boot")?.textContent ?? '{"me":null}') as Boot;
let me: MeResponse | null = boot.me;
const listeners = new Set<() => void>();

export function setMe(next: MeResponse | null): void {
  me = next;
  for (const listener of listeners) listener();
}

export async function refreshMe(): Promise<void> {
  setMe(await get<MeResponse>("/api/me"));
}

export function useMe(): MeResponse | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => me,
  );
}

export const currentMe = (): MeResponse | null => me;
