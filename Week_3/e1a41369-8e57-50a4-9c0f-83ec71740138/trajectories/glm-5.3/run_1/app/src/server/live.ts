import type { Player, Party, Quest, StrikeEvent, ChatMessage, Notice, Task, ImportRecord } from '../shared/types.js';

export type LiveEvent =
  | { event: 'player'; data: Player }
  | { event: 'tasks'; data: { habits: Task[]; dailies: Task[]; todos: Task[]; rewards: Task[] } }
  | { event: 'party'; data: { party: Party | null } }
  | { event: 'invite'; data: { invites: { id: string; partyId: string; partyName: string; from: string }[] } }
  | { event: 'quest'; data: Quest }
  | { event: 'strike'; data: StrikeEvent & { questId: string } }
  | { event: 'chat'; data: ChatMessage & { partyId: string } }
  | { event: 'banner'; data: { partyId: string; bannerUrl: string | null } }
  | { event: 'notice'; data: Notice };

type UserId = string;
type Send = (event: string, data: unknown) => void;

interface Listener {
  userId: string;
  partyId: string | null;
  send: Send;
}

/**
 * The live hub: one place that knows which open SSE connections exist and
 * which player and party each belongs to.
 */
class LiveHub {
  private listeners = new Set<Listener>();

  add(userId: UserId, partyId: string | null, send: Send): () => void {
    const l: Listener = { userId, partyId, send };
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }

  setParty(userId: UserId, partyId: string | null): void {
    for (const l of this.listeners) {
      if (l.userId === userId) l.partyId = partyId;
    }
  }

  toUser(userId: UserId, event: string, data: unknown): void {
    for (const l of this.listeners) {
      if (l.userId === userId) l.send(event, data);
    }
  }

  toParty(partyId: string, event: string, data: unknown, exceptUserId?: string): void {
    for (const l of this.listeners) {
      if (l.partyId === partyId) l.send(event, data);
    }
  }
}

export const live = new LiveHub();
