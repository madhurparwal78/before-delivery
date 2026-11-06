/**
 * Shared browser state: the signed-in account, the loaded programme and the
 * live-region elements. The pages read it; nothing here decides permissions.
 */

import type { Account, Session, Speaker, Stage } from './api.js';

export interface AppState {
  account: Account | null;
  stages: Stage[];
  sessions: Session[];
  speakers: Speaker[];
  refresh: (() => Promise<void>) | null;
  bookingMessages: HTMLElement | null;
  accountMessages: HTMLElement | null;
  contestMessages: HTMLElement | null;
  organiserMessages: HTMLElement | null;
  /** The title link that was followed from the agenda board. */
  followedTitle: HTMLElement | null;
}

export const state: AppState = {
  account: null,
  stages: [],
  sessions: [],
  speakers: [],
  refresh: null,
  bookingMessages: null,
  accountMessages: null,
  contestMessages: null,
  organiserMessages: null,
  followedTitle: null,
};

export function mergeSessions(current: Session[], fresh: Session[]): Session[] {
  const byId = new Map(current.map((s) => [s.id, s]));
  for (const s of fresh) byId.set(s.id, s);
  return [...byId.values()];
}
