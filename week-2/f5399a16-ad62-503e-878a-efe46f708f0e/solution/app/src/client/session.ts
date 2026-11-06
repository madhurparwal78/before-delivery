// A session that ended mid-form: the server said so, the page stays as typed, and the draft waits on this device.

import { useSyncExternalStore } from 'react';
import { COPY } from '../shared/copy';
import { announce } from './announce';

let ended = false;
const listeners = new Set<() => void>();

function changed(): void {
  for (const listener of listeners) listener();
}

/** Said once on the first refresh that finds it, and again whenever a person's action meets it. */
export function sessionEnded(byAction: boolean): void {
  if (byAction || !ended) announce(COPY.sessionEnded);
  ended = true;
  changed();
}

export function sessionRestored(): void {
  ended = false;
  changed();
}

export function useSessionEnded(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => ended,
  );
}

// The form being typed in, so `Sign in again` can keep it.

interface Resume {
  address: string;
  key: string;
  values: unknown;
}

const RESUME_KEY = 'clapstick.resume';
let active: { key: string; values: () => unknown } | null = null;

export function setActiveForm(form: { key: string; values: () => unknown } | null): void {
  active = form;
}

export function keepDraftForSignIn(): void {
  if (!active) return;
  const resume: Resume = { address: location.pathname + location.search, key: active.key, values: active.values() };
  try {
    localStorage.setItem(RESUME_KEY, JSON.stringify(resume));
  } catch {
    // A device that refuses storage keeps no draft; signing in still returns to the address.
  }
}

export function readResume(key: string): Resume | null {
  try {
    const raw = localStorage.getItem(RESUME_KEY);
    if (!raw) return null;
    const resume = JSON.parse(raw) as Resume;
    return resume.key === key && resume.address === location.pathname + location.search ? resume : null;
  } catch {
    return null;
  }
}

export function clearResume(): void {
  try {
    localStorage.removeItem(RESUME_KEY);
  } catch {
    // Nothing was kept on a device that refuses storage.
  }
}
