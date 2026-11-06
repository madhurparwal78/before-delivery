import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { prefersReducedMotion } from "../hooks.ts";

const FADE_MS = 167;
const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const STOPS = "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex='-1'])";

interface Instance {
  id: number;
  closing: boolean;
  opener: HTMLElement | null;
}

export interface SessionDialogs {
  instances: Instance[];
  /** Opens a new dialog session; any earlier one still fading out stays inert. */
  open: (opener: HTMLElement | null) => number;
  /** Closes a session and returns focus to its opener. A session that is no longer the active one is left alone. */
  close: (id: number) => void;
  /** True while `id` is the open dialog session. */
  isActive: (id: number) => boolean;
  remove: (id: number) => void;
}

/** Each opening is a new dialog session with its own id; responses are applied only to the session that sent them. */
export function useSessionDialogs(): SessionDialogs {
  const [instances, setInstances] = useState<Instance[]>([]);
  const counter = useRef(0);
  const active = useRef<number | null>(null);
  const live = useRef<Instance[]>([]);
  live.current = instances;

  const open = useCallback((opener: HTMLElement | null) => {
    counter.current += 1;
    const id = counter.current;
    active.current = id;
    setInstances((list) => [...list.map((entry) => ({ ...entry, closing: true })), { id, closing: false, opener }]);
    return id;
  }, []);

  const close = useCallback((id: number) => {
    if (active.current !== id) return;
    active.current = null;
    live.current.find((entry) => entry.id === id)?.opener?.focus({ preventScroll: true });
    setInstances((list) => list.map((entry) => (entry.id === id ? { ...entry, closing: true } : entry)));
  }, []);

  const isActive = useCallback((id: number) => active.current === id, []);
  const remove = useCallback((id: number) => setInstances((list) => list.filter((entry) => entry.id !== id)), []);
  return { instances, open, close, isActive, remove };
}

interface FrameProps {
  title: string;
  closing: boolean;
  onCancel: () => void;
  onGone: () => void;
  children: ReactNode;
}

/** A modal frame: fades in and out, traps Tab, closes on Escape. A closing frame is inert and never intercepts a pointer. */
export function ModalFrame({ title, closing, onCancel, onGone, children }: FrameProps) {
  const backdrop = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (prefersReducedMotion() || !backdrop.current) return;
    backdrop.current.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: EASE });
  }, []);

  useLayoutEffect(() => {
    if (!closing) return;
    const node = backdrop.current;
    if (!node || prefersReducedMotion()) {
      onGone();
      return;
    }
    const fade = node.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, easing: EASE, fill: "forwards" });
    void fade.finished.then(onGone, onGone);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closing]);

  useEffect(() => {
    if (closing) return undefined;
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [closing, onCancel]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "Tab") return;
    const stops = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(STOPS));
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && (document.activeElement === first || !event.currentTarget.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className={closing ? "modal-backdrop leaving" : "modal-backdrop"} ref={backdrop} inert={closing} aria-hidden={closing || undefined}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onKeyDown={onKeyDown}>
        {children}
      </div>
    </div>
  );
}
