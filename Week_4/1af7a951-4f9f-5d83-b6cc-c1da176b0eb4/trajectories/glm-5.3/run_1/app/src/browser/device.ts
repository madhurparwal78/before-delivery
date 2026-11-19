// Device-kept entries, memos and the pending sign-out. Everything kept on
// the device is stamped with the enrolment id of the dreamer who wrote it,
// so a shared browser never shows, counts or sends another dreamer's work.

import { uuid } from './api.js';

const KEPT_KEY = 'lf_kept_entries';
const MEMO_KEY = 'lf_kept_memos';
const REMEMBER_KEY = 'lf_last_enrollment';
const PENDING_SIGNOUT = 'lf_pending_signout';

export interface KeptEntry {
  id: string;
  enrollmentId: string;
  title: string;
  text: string;
  dreams_recalled: number;
  lucid: boolean;
  wbtb: boolean;
  technique: 'none' | 'mild' | 'ssild';
  technique_minutes: number;
  createdAt: number;
  state: 'kept' | 'saved' | 'rejected';
  rejection?: string;
}

export interface KeptMemo {
  entryId: string;
  enrollmentId: string;
  blob: ArrayBuffer;
  contentType: string;
  durationMs: number;
}

export function loadKept(): KeptEntry[] {
  try {
    const raw = localStorage.getItem(KEPT_KEY);
    return raw === null ? [] : (JSON.parse(raw) as KeptEntry[]);
  } catch {
    return [];
  }
}

export function saveKept(entries: KeptEntry[]): void {
  localStorage.setItem(KEPT_KEY, JSON.stringify(entries));
}

export function loadRememberedId(): string | null {
  try {
    return localStorage.getItem(REMEMBER_KEY);
  } catch {
    return null;
  }
}

export function rememberId(id: string): void {
  localStorage.setItem(REMEMBER_KEY, id);
}

export function clearRememberedId(): void {
  localStorage.removeItem(REMEMBER_KEY);
}

export function pendingSignOut(): boolean {
  return localStorage.getItem(PENDING_SIGNOUT) === '1';
}

export function setPendingSignOut(value: boolean): void {
  if (value) localStorage.setItem(PENDING_SIGNOUT, '1');
  else localStorage.removeItem(PENDING_SIGNOUT);
}

// memos are kept separately because they hold audio bytes
export function loadMemos(): KeptMemo[] {
  try {
    const raw = localStorage.getItem(MEMO_KEY);
    if (raw === null) return [];
    return (JSON.parse(raw) as (KeptMemo & { blob64: string })[]).map((m) => ({
      entryId: m.entryId,
      enrollmentId: m.enrollmentId,
      blob: base64ToBuffer(m.blob64),
      contentType: m.contentType,
      durationMs: m.durationMs,
    }));
  } catch {
    return [];
  }
}

export function saveMemos(memos: KeptMemo[]): void {
  const serializable = memos.map((m) => ({ ...m, blob64: bufferToBase64(m.blob) }));
  localStorage.setItem(MEMO_KEY, JSON.stringify(serializable));
}

export function memoFor(entryId: string): KeptMemo | null {
  return loadMemos().find((m) => m.entryId === entryId) ?? null;
}

export function removeMemo(entryId: string): void {
  saveMemos(loadMemos().filter((m) => m.entryId !== entryId));
}

export function newKeptEntry(enrollmentId: string, fields: Omit<KeptEntry, 'id' | 'enrollmentId' | 'createdAt' | 'state'>): KeptEntry {
  return { id: uuid(), enrollmentId, createdAt: Date.now(), state: 'kept', ...fields };
}

function bufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i] ?? 0);
  return btoa(binary);
}

function base64ToBuffer(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
