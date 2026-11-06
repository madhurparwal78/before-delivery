// The Notices toasts: every action result in the brief is announced here.
import { useSyncExternalStore } from "react";

interface Notice {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
  leaving: boolean;
}

let notices: Notice[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function remove(id: number): void {
  notices = notices.map((n) => (n.id === id ? { ...n, leaving: true } : n));
  emit();
  setTimeout(() => {
    notices = notices.filter((n) => n.id !== id);
    emit();
  }, 200);
}

/** Shows a toast for 6 seconds, or 10 when it carries an action such as "Undo restore". */
export function notify(text: string, action?: Notice["action"]): void {
  const id = nextId++;
  notices = [...notices.filter((n) => n.text !== text || n.action).slice(-3), { id, text, action, leaving: false }];
  emit();
  setTimeout(() => remove(id), action ? 10_000 : 6000);
}

function useNotices(): Notice[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => notices,
  );
}

export function NoticesRegion(): JSX.Element {
  const list = useNotices();
  return (
    <div className="notices" role="status" aria-label="Notices" aria-live="polite">
      {list.map((n) => (
        <div key={n.id} className={`toast${n.leaving ? " leaving" : ""}`}>
          <p>{n.text}</p>
          {n.action && (
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => {
                remove(n.id);
                n.action?.run();
              }}
            >
              {n.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
