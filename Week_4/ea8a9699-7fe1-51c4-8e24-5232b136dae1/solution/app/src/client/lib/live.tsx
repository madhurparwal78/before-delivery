// Named live regions (brief: Feedback states). Each region is mounted with its screen and written directly,
// so an announcement shows at once; repeating the same copy clears first so it is read again.
import { useCallback, useMemo, useRef, type RefObject } from "react";
import { TriangleAlert } from "lucide-react";

export interface Live {
  ref: RefObject<HTMLParagraphElement | null>;
  say: (text: string, failure?: boolean) => void;
}

export function useLive(): Live {
  const ref = useRef<HTMLParagraphElement | null>(null);
  const say = useCallback((text: string, failure = false) => {
    const el = ref.current;
    if (!el) return;
    const message = el.querySelector<HTMLElement>("[data-message]");
    if (!message) return;
    el.dataset.failure = failure ? "true" : "false";
    if (message.textContent === text) {
      message.textContent = "";
      queueMicrotask(() => {
        message.textContent = text;
      });
    } else {
      message.textContent = text;
    }
  }, []);
  return useMemo(() => ({ ref, say }), [say]);
}

export function LiveRegion({ live, name, className = "" }: { live: Live; name: string; className?: string }) {
  return (
    <p ref={live.ref} role="status" aria-label={name} aria-live="polite" className={`status-line ${className}`} data-failure="false">
      <TriangleAlert className="status-line__mark" aria-hidden="true" size={14} />
      <span data-message="" />
    </p>
  );
}
