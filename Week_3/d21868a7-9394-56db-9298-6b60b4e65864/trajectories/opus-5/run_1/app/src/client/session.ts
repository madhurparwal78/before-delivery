import { api } from './api.ts';
import type { User } from './types.ts';
import { setUser } from './userState.ts';

/** The order draft kept in this browser tab, and the signed-in person's reload. */

let draftRestoreRequested = false;

export { getUser, requireUser, setUser } from './userState.ts';

export async function refreshUser(): Promise<void> {
  try {
    const reply = await api.get<{ user: User }>('/api/me');
    setUser(reply.user);
  } catch {
    setUser(null);
  }
}

export interface OrderDraft {
  turnout: string;
  windowId: string;
  volumeMl: string;
  operatorCode: string;
  standbyCode: string;
}

function draftKey(growerId: number): string {
  return `ditchbook:order-draft:${growerId}`;
}

export function saveDraft(growerId: number, draft: OrderDraft): void {
  window.sessionStorage.setItem(draftKey(growerId), JSON.stringify(draft));
}

export function loadDraft(growerId: number): OrderDraft | null {
  const stored = window.sessionStorage.getItem(draftKey(growerId));
  if (stored === null) return null;
  return JSON.parse(stored) as OrderDraft;
}

export function clearDraft(growerId: number): void {
  window.sessionStorage.removeItem(draftKey(growerId));
}

export function requestDraftRestore(): void {
  draftRestoreRequested = true;
}

export function takeDraftRestore(): boolean {
  const requested = draftRestoreRequested;
  draftRestoreRequested = false;
  return requested;
}
