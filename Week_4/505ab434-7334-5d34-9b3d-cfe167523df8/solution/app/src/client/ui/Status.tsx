// `status "Page status"`: the one polite region that carries every success message (brief: Feedback states).
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

interface StatusValue {
  say(text: string): void;
}

const Context = createContext<StatusValue | null>(null);
const TextContext = createContext("");

export function PageStatusProvider({ children }: { children: ReactNode }): ReactNode {
  const [text, setText] = useState("");
  const say = useCallback((next: string) => setText(next), []);
  const value = useMemo(() => ({ say }), [say]);
  return (
    <Context.Provider value={value}>
      <TextContext.Provider value={text}>{children}</TextContext.Provider>
    </Context.Provider>
  );
}

/** Announces a success message in `status "Page status"`. */
export function usePageStatus(): (text: string) => void {
  const value = useContext(Context);
  if (!value) throw new Error("usePageStatus outside PageStatusProvider");
  return value.say;
}

/** The region itself; it exists on every signed-in screen even while empty so announcements are read. */
export function PageStatus(): ReactNode {
  const text = useContext(TextContext);
  return (
    <div role="status" aria-label="Page status" className={text ? "page-status filled" : "page-status"}>
      {text}
    </div>
  );
}
