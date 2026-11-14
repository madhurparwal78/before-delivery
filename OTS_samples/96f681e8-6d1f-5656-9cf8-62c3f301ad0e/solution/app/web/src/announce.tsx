import { type ReactNode, createContext, useCallback, useContext, useRef, useState } from "react";

interface Announcer {
  announce: (text: string) => void;
}

const AnnouncerContext = createContext<Announcer>({ announce: () => undefined });

const burstMs = 100;
const lifetimeMs = 6000;

export function useAnnounce(): (text: string) => void {
  return useContext(AnnouncerContext).announce;
}

/** Holds the one live region of the page: `status "Announcements"`. */
export function AnnouncerProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<{ id: number; text: string }[]>([]);
  const last = useRef({ at: -Infinity, id: 0 });
  const announce = useCallback((text: string) => {
    const now = performance.now();
    const id = last.current.id + 1;
    const sameBurst = now - last.current.at <= burstMs;
    last.current = { at: now, id };
    setMessages((current) => [...(sameBurst ? current : []), { id, text }]);
    window.setTimeout(() => setMessages((current) => current.filter((m) => m.id !== id)), lifetimeMs);
  }, []);
  return (
    <AnnouncerContext.Provider value={{ announce }}>
      {children}
      <div role="status" aria-label="Announcements" className="announcements">
        {messages.map((m) => (
          <span key={m.id}>{m.text}</span>
        ))}
      </div>
    </AnnouncerContext.Provider>
  );
}
