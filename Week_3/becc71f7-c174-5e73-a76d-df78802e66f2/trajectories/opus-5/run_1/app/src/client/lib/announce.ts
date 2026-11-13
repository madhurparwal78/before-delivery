import { useEffect, useState } from 'preact/hooks';

export interface Announcement {
  text: string;
  /** The session copy carries a Sign in again link inside the live region. */
  withSignIn: boolean;
  key: number;
}

let announcement: Announcement | null = null;
let key = 0;
const listeners = new Set<() => void>();

function publish(): void {
  for (const listener of listeners) listener();
}

/** The one live region's copy. A refresh never changes it; only an action does. */
export function announce(text: string, withSignIn = false): void {
  key += 1;
  announcement = { text, withSignIn, key };
  publish();
}

export function useAnnouncement(): Announcement | null {
  const [value, setValue] = useState(announcement);
  useEffect(() => {
    const listener = (): void => setValue(announcement);
    listeners.add(listener);
    listener();
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return value;
}
