import type { ReactNode } from "react";

/**
 * A persistent live region that shows and announces the latest result of its action. A new `announcement`
 * number re-announces the same words (every sync attempt is announced, even when its counts repeat).
 */
export function Status({ label, announcement, liveOutside, children }: { label: string; announcement?: number; liveOutside?: boolean; children: ReactNode }) {
  return (
    <div role="status" aria-label={label} className="status-line" data-live-outside={liveOutside || undefined}>
      {children ? <span key={announcement}>{children}</span> : null}
    </div>
  );
}

export function FieldError({ id, message }: { id: string; message: string | undefined }) {
  return (
    <p id={id} className="field-error" hidden={!message}>
      {message}
    </p>
  );
}
