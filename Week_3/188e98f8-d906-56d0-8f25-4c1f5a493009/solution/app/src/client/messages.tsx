import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import tokens from "../shared/tokens.json";

type Tone = "info" | "error";

interface Messages {
  /** A result copy: shown for exactly the message lifetime, then cleared. */
  say: (text: string, tone?: Tone) => void;
  /** A pending copy: stays until its result arrives. */
  pending: (text: string) => void;
  clear: () => void;
}

const MessagesContext = createContext<Messages | null>(null);

export function useMessages(): Messages {
  const messages = useContext(MessagesContext);
  if (messages === null) throw new Error("MessagesProvider is missing");
  return messages;
}

export function MessagesProvider({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState<{ text: string; tone: Tone } | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const stopTimer = () => window.clearTimeout(timer.current);
  const clear = useCallback(() => {
    stopTimer();
    setShown(null);
  }, []);
  const say = useCallback((text: string, tone: Tone = "info") => {
    stopTimer();
    setShown({ text, tone });
    timer.current = window.setTimeout(() => setShown(null), tokens.ms.message);
  }, []);
  const pending = useCallback((text: string) => {
    stopTimer();
    setShown({ text, tone: "info" });
  }, []);
  useEffect(() => stopTimer, []);

  const value = useMemo(() => ({ say, pending, clear }), [say, pending, clear]);
  return (
    <MessagesContext.Provider value={value}>
      {children}
      {createPortal(
        <div role="status" aria-label="Desk messages" className="desk-messages" data-tone={shown?.tone}>
          {shown?.text}
        </div>,
        document.getElementById("layers") as HTMLElement,
      )}
    </MessagesContext.Provider>
  );
}
