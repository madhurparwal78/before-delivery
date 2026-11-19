/** The polite Notices region: every success, pending and change message from the published feedback table. */
import { createPortal } from "react-dom";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

interface Notice {
  readonly id: number;
  readonly text: string;
}

const NOTICE_LIFETIME_MS = 12_000;

const NoticesContext = createContext<(text: string) => void>(() => undefined);

export const useNotify = (): ((text: string) => void) => useContext(NoticesContext);

export const NoticesProvider = ({ children }: { children: ReactNode }): ReactNode => {
  const [notice, setNotice] = useState<Notice | null>(null);
  const counter = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const notify = useCallback((text: string) => {
    counter.current += 1;
    setNotice({ id: counter.current, text });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setNotice(null), NOTICE_LIFETIME_MS);
  }, []);
  const value = useMemo(() => notify, [notify]);
  return (
    <NoticesContext.Provider value={value}>
      {children}
      {createPortal(
        <div className="notices" role="status" aria-label="Notices" aria-live="polite">
          {notice ? <p key={notice.id}>{notice.text}</p> : null}
        </div>,
        document.getElementById("notices") as HTMLElement,
      )}
    </NoticesContext.Provider>
  );
};
