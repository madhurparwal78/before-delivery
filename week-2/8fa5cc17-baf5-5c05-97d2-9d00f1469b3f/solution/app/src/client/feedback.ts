// The frame's live regions: Announcements, Save status, the unnamed alert and the storage banner.
import { useSyncExternalStore } from 'react';

interface FeedbackState {
  announcement: string;
  /** bumped on every announcement so the same text is spoken again */
  announceSeq: number;
  saveStatus: string;
  alert: string;
  alertSeq: number;
  storage: 'available' | 'unavailable';
}

let state: FeedbackState = { announcement: '', announceSeq: 0, saveStatus: '', alert: '', alertSeq: 0, storage: 'available' };
const listeners = new Set<() => void>();

function set(patch: Partial<FeedbackState>): void {
  state = { ...state, ...patch };
  for (const fn of listeners) fn();
}

export const announce = (text: string): void => set({ announcement: text, announceSeq: state.announceSeq + 1 });
export const showAlert = (text: string): void => set({ alert: text, alertSeq: state.alertSeq + 1 });
export const clearAlert = (): void => set({ alert: '' });
export const setSaveStatus = (text: string): void => set({ saveStatus: text });
export const setStorage = (storage: FeedbackState['storage']): void => {
  if (state.storage !== storage) set({ storage });
};

export function useFeedback(): FeedbackState {
  return useSyncExternalStore((fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, () => state);
}

// Copy shared by several screens (brief: Feedback states).
export const COPY = {
  saving: 'Saving',
  saved: 'Saved',
  notSaved: 'Not saved. Check your connection and try again.',
  conflict: 'This block changed on another device.',
  emptyDay: "Nothing written today. Start with a line from what you're reading.",
  notFound: "We can't find that note.",
  quoteRefused: "That block couldn't be quoted.",
  storageBanner: 'Attachments are unavailable right now. Your writing is still saved.',
  attachmentOutage: "This attachment can't be shown while storage is unavailable.",
  syncPaused: 'Live updates paused. Reconnecting.',
  syncLive: 'Live',
  signedOut: "You've been signed out on this device.",
} as const;

export const plural = (n: number, noun: string): string => `${n} ${n === 1 ? noun : `${noun}s`}`;
