import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface Announcer {
  announce(text: string): void;
}

const Context = createContext<Announcer>({ announce: () => undefined });

/** The one live region: `status` named Announcements, holding only the latest text. */
export function AnnouncerProvider({ children }: { children: ReactNode }): JSX.Element {
  const [line, setLine] = useState({ text: "", nonce: 0 });
  const announce = useCallback((text: string) => setLine((previous) => ({ text, nonce: previous.nonce + 1 })), []);
  const value = useMemo(() => ({ announce }), [announce]);
  return (
    <Context.Provider value={value}>
      {children}
      {createPortal(
        <div role="status" aria-live="polite" aria-label="Announcements" className="sr-only">
          <span key={line.nonce}>{line.text}</span>
        </div>,
        document.body,
      )}
    </Context.Provider>
  );
}

export function useAnnounce(): (text: string) => void {
  return useContext(Context).announce;
}
