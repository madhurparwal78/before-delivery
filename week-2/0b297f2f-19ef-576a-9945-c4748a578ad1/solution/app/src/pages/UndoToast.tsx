import { useEffect, useRef, useState } from "react";
import { Button } from "../ui/Button";

export interface ToastState {
  actionId: string;
  kind: "remove" | "move";
  title: string;
  placementId: string;
  /** performance.now() at which the server's window closes, from its remainingMs */
  deadline: number;
}

/** Counts down from the server's remaining time by the time elapsed on the device; never restarts. */
export function UndoToast({ toast, busy, onUndo, onExpire }: { toast: ToastState; busy: boolean; onUndo: () => void; onExpire: (hadFocus: boolean) => void }) {
  const region = useRef<HTMLElement>(null);
  const [, tick] = useState(0);
  const seconds = Math.ceil((toast.deadline - performance.now()) / 1000);
  useEffect(() => {
    const timer = setInterval(() => {
      if (toast.deadline - performance.now() <= 0) {
        clearInterval(timer);
        onExpire(region.current?.contains(document.activeElement) ?? false);
      } else tick((n) => n + 1);
    }, 100);
    return () => clearInterval(timer);
  }, [toast, onExpire]);
  return (
    <section ref={region} aria-label="Undo" className="toast">
      <p className="toast-text">{toast.kind === "remove" ? `${toast.title} removed.` : `${toast.title} moved.`}</p>
      <p className="toast-time num">{`${Math.max(0, seconds)} s left`}</p>
      <Button tone="primary" busy={busy} onClick={onUndo} data-undo="true">
        Undo
      </Button>
    </section>
  );
}
