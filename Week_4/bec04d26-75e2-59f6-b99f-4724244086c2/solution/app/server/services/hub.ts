import type { LiveEvent, Role } from "../../shared/types";

interface Subscriber {
  practiceId: string;
  clientId: string | null;
  role: Role;
  send: (event: LiveEvent) => void;
}

const subscribers = new Set<Subscriber>();

export function subscribe(subscriber: Subscriber): () => void {
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
}

export const practicesWithScreens = (): Set<string> => new Set([...subscribers].map((s) => s.practiceId));

/** Sends to every open screen of the practice that may see it: owners only hear about their own client. */
export function publish(practiceId: string, event: LiveEvent, audience: { clientId?: string; bookkeeperOnly?: true } = {}): void {
  for (const s of subscribers) {
    if (s.practiceId !== practiceId) continue;
    if (s.role === "owner" && (audience.bookkeeperOnly || s.clientId !== audience.clientId)) continue;
    s.send(event);
  }
}

/** Service banners concern every bookkeeper, whatever the practice. */
export function broadcastToBookkeepers(event: LiveEvent): void {
  for (const s of subscribers) if (s.role === "bookkeeper") s.send(event);
}
