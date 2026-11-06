// Named live regions. A StatusLine is in normal flow and keeps its last message visible.
// announce(text) repeats an identical message so assistive technology hears it again.

import { useCallback, useRef, useState, useSyncExternalStore } from "react";

export function StatusLine({ name, message }: { name: string; message: string }) {
  return (
    <div role="status" aria-label={`${name} announcements`} className="status-line">
      {message}
    </div>
  );
}

export interface Announcer {
  message: string;
  announce: (text: string) => void;
}

/** A live region message owned by one screen. */
export function useAnnouncer(): Announcer {
  const [message, setMessage] = useState("");
  const last = useRef("");
  const announce = useCallback((text: string) => {
    if (text === last.current) {
      setMessage("");
      setTimeout(() => setMessage(text), 40);
    } else {
      setMessage(text);
    }
    last.current = text;
  }, []);
  return { message, announce };
}

/** A live region message shared across screens (the tray's). */
export function createAnnouncer(): { useMessage: () => string; announce: (text: string) => void } {
  let message = "";
  const listeners = new Set<() => void>();
  const set = (text: string) => {
    message = text;
    for (const listener of listeners) listener();
  };
  return {
    useMessage: () =>
      useSyncExternalStore((listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }, () => message),
    announce: (text) => {
      if (text === message) {
        set("");
        setTimeout(() => set(text), 40);
      } else {
        set(text);
      }
    },
  };
}
