import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { config } from '../config.ts';
import { animateWithId } from './motion.ts';

interface Toast { id: number; text: string }

let toasts: readonly Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function publish(next: readonly Toast[]): void {
  toasts = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Shows a transient notice in `status "Notices"` for `PLOT_TOAST_MS`. A toast never takes focus. */
export function pushToast(text: string): void {
  const id = nextId++;
  publish([...toasts, { id, text }]);
  setTimeout(() => publish(toasts.filter((toast) => toast.id !== id)), config.toastMs);
}

function ToastItem({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (ref.current) {
      animateWithId(ref.current, [{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }], {
        id: 'toast-enter',
        duration: 120,
      });
    }
  }, []);
  return <div ref={ref} className="toast">{text}</div>;
}

/**
 * The `status "Notices"` stack, top centre. Mount once at the app root. It lives in the top layer so a toast shows
 * above an open modal dialog; each new toast re-enters the top layer to stay above a dialog opened since.
 */
export function Toasts() {
  const current = useSyncExternalStore(subscribe, () => toasts);
  const stack = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    stack.current?.hidePopover();
    stack.current?.showPopover();
  }, [current.length]);
  return (
    <div ref={stack} popover="manual" className="toasts" role="status" aria-label="Notices" aria-live="polite">
      {current.map((toast) => <ToastItem key={toast.id} text={toast.text} />)}
    </div>
  );
}
