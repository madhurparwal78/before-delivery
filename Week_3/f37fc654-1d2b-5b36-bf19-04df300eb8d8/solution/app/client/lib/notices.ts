// Toasts in status "Notices" (6 s each) and the outage banners in status "Service notices".
import { BANNERS, type ServiceName } from "../../shared/copy";
import { call } from "./api";
import { store } from "./store";

export const notices = store<{ toasts: { id: number; text: string }[]; down: ServiceName[] }>({ toasts: [], down: [] });

let next = 1;

export function toast(text: string): void {
  const id = next++;
  notices.set((s) => ({ ...s, toasts: [...s.toasts, { id, text }] }));
  setTimeout(() => notices.set((s) => ({ ...s, toasts: s.toasts.filter((t) => t.id !== id) })), 6000);
}

async function poll(): Promise<void> {
  try {
    const { services } = await call<{ services: Record<ServiceName, "up" | "down"> }>("/api/status");
    notices.set({ down: (Object.keys(BANNERS) as ServiceName[]).filter((name) => services[name] === "down") });
  } catch {
    notices.set({ down: ["postgres"] });
  }
}

export function watchServices(): void {
  void poll();
  setInterval(() => void poll(), 5000);
}

/** The copy an action's live region shows for a 503: the matching banner. */
export function bannerFor(code: string): string | null {
  const map: Record<string, ServiceName> = {
    billing_unavailable: "killbill", storage_unavailable: "minio", webhooks_unavailable: "svix", signin_unavailable: "keycloak", database_unavailable: "postgres",
  };
  return map[code] ? BANNERS[map[code]] : null;
}
