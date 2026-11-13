import { useEffect, useRef } from "react";

const REFETCH_MS = 60_000;

interface RefetchHandlers<T> {
  load: () => Promise<T>;
  onData: (data: T) => void;
  onError?: (error: unknown) => void;
}

/** Fetches on load (and whenever `key` changes), every 60 seconds and when the window regains focus. */
export function useRefetch<T>(handlers: RefetchHandlers<T>, key: string): void {
  const latest = useRef(handlers);
  latest.current = handlers;
  useEffect(() => {
    let alive = true;
    const run = () => {
      latest.current
        .load()
        .then((data) => {
          if (alive) latest.current.onData(data);
        })
        .catch((error: unknown) => {
          if (alive) latest.current.onError?.(error);
        });
    };
    run();
    const timer = window.setInterval(run, REFETCH_MS);
    window.addEventListener("focus", run);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", run);
    };
  }, [key]);
}

export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} · Stowdeck`;
  }, [title]);
}

export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}
