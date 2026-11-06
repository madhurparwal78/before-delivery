// What GET /api/status last reported, shared by the banner, download controls and the held upload.
import { useSyncExternalStore } from "react";
import { api } from "./api";
import { onSignOut } from "./session";

interface ServiceStatus {
  storage: "up" | "down";
  mail: "up" | "down";
}

let current: ServiceStatus | null = null;
const listeners = new Set<(next: ServiceStatus, previous: ServiceStatus | null) => void>();
const renders = new Set<() => void>();

export function onStatus(listener: (next: ServiceStatus, previous: ServiceStatus | null) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function report(next: ServiceStatus): void {
  const previous = current;
  if (previous && previous.storage === next.storage && previous.mail === next.mail) return;
  current = next;
  for (const l of listeners) l(next, previous);
  for (const r of renders) r();
}

export async function refreshStatus(): Promise<void> {
  const result = await api<ServiceStatus>("/api/status");
  if (result.ok) report({ storage: result.data.storage, mail: result.data.mail });
}

/** A storage 503 is the server reporting storage down, ahead of the next status poll. */
export function storageReportedDown(): void {
  report({ storage: "down", mail: current?.mail ?? "up" });
}

export function useServiceStatus(): ServiceStatus | null {
  return useSyncExternalStore((l) => {
    renders.add(l);
    return () => renders.delete(l);
  }, () => current);
}

onSignOut(() => {
  current = null;
  for (const r of renders) r();
});
