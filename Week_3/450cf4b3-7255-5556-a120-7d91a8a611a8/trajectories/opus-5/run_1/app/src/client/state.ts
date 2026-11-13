import type { Me } from '../shared/types';

export interface UploadDraft {
  userId: string;
  kind: string;
  expiresOn: string;
  perOccurrenceLimit: string;
  additionalInsured: boolean;
  file: File | null;
}

export interface PurchaseAttempt {
  key: string;
  hours: number;
}

interface SessionState {
  user: Me | null;
  /** Who was signed in last, kept through a 401 so the same account keeps its draft. */
  lastUserId: string | null;
  epoch: number;
  uploadDraft: UploadDraft | null;
}

export const session: SessionState = {
  user: null,
  lastUserId: null,
  epoch: 0,
  uploadDraft: null,
};

/** Every in-page record of the previous user goes before anything is drawn for the next one. */
export function startNewSignIn(user: Me | null, keepDraftForUserId: string | null): void {
  session.epoch += 1;
  session.user = user;
  session.lastUserId = user === null ? null : user.id;
  if (keepDraftForUserId === null || session.uploadDraft?.userId !== keepDraftForUserId) {
    session.uploadDraft = null;
  }
}

export function currentEpoch(): number {
  return session.epoch;
}

function attemptKeyFor(userId: string): string {
  return `sh.purchase.${userId}`;
}

export function readPurchaseAttempt(userId: string): PurchaseAttempt | null {
  try {
    const raw = window.sessionStorage.getItem(attemptKeyFor(userId));
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object') return null;
    const record = parsed as { key?: unknown; hours?: unknown };
    if (typeof record.key !== 'string' || typeof record.hours !== 'number') return null;
    return { key: record.key, hours: record.hours };
  } catch {
    return null;
  }
}

export function writePurchaseAttempt(userId: string, attempt: PurchaseAttempt): void {
  try {
    window.sessionStorage.setItem(attemptKeyFor(userId), JSON.stringify(attempt));
  } catch {
    // a tab without storage simply loses the resume hint
  }
}

export function clearPurchaseAttempt(userId: string): void {
  try {
    window.sessionStorage.removeItem(attemptKeyFor(userId));
  } catch {
    // nothing to clear
  }
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
