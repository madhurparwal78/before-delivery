import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { Info } from "lucide-react";
import { useStatus } from "./status";

/** The one notice id for "you were removed", shared by the app, the classroom page and the editor so it shows once. */
export const REMOVED_NOTICE_ID = "removed";

export interface NoticeAction {
  label: string;
  onClick: () => void;
}

interface Notice {
  id: string;
  message: string;
  actions?: NoticeAction[];
}

interface NoticeValue {
  notices: Notice[];
  /** Adds or replaces the notice with this id; new copy is also posted to Status once. */
  setNotice: (notice: Notice) => void;
  clearNotice: (id: string) => void;
}

const NoticeContext = createContext<NoticeValue | null>(null);

export function NoticeProvider({ children }: { children: ReactNode }) {
  const { announce } = useStatus();
  const [notices, setNotices] = useState<Notice[]>([]);
  const posted = useRef(new Map<string, string>());

  const setNotice = useCallback((notice: Notice) => {
    if (posted.current.get(notice.id) !== notice.message) {
      posted.current.set(notice.id, notice.message);
      announce(notice.message);
    }
    setNotices((current) => (current.some((n) => n.id === notice.id)
      ? current.map((n) => (n.id === notice.id ? notice : n))
      : [...current, notice]));
  }, [announce]);

  const clearNotice = useCallback((id: string) => {
    posted.current.delete(id);
    setNotices((current) => current.filter((n) => n.id !== id));
  }, []);

  const value = useMemo(() => ({ notices, setNotice, clearNotice }), [notices, setNotice, clearNotice]);
  return <NoticeContext.Provider value={value}>{children}</NoticeContext.Provider>;
}

export function useNotices(): NoticeValue {
  const value = useContext(NoticeContext);
  if (!value) throw new Error("useNotices outside NoticeProvider");
  return value;
}

/** The full-width band under the header; present only while a notice stands. */
export function NoticeBand() {
  const { notices } = useNotices();
  if (notices.length === 0) return null;
  return (
    <section className="notice-band" role="region" aria-label="Notice">
      <ul>
        {notices.map((notice) => (
          <li className="notice-item" key={notice.id}>
            <Info size={20} aria-hidden="true" />
            <p>{notice.message}</p>
            {notice.actions?.map((action) => (
              <button className="pill pill--outline pill--small" type="button" key={action.label} onClick={action.onClick}>
                {action.label}
              </button>
            ))}
          </li>
        ))}
      </ul>
    </section>
  );
}
