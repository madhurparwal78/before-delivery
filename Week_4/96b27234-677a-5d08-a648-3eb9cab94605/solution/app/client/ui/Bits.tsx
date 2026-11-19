import type { ReactNode } from "react";
import type { Result } from "../lib/useAction";
import { Lantern } from "./Drawings";

/** A named live region for one action's result. It exists before the first result so it is announced. */
export function Status({ name, result, children }: { name: string; result?: Result; children?: ReactNode }) {
  const kind = result?.kind ?? "idle";
  return (
    <p role="status" aria-label={name} className={`result result-${kind}`}>
      {children ?? result?.text}
    </p>
  );
}

export function Chip({ children, tone = "plain" }: { children: ReactNode; tone?: "plain" | "calm" | "danger" | "accent" }) {
  return <span className={`chip chip-${tone}`}>{children}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="empty">
      <Lantern size={64} />
      <p>{children}</p>
    </div>
  );
}

/** Static paper blocks in a list's own shape while a real fetch runs; no animation. */
export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="skeleton-list" aria-busy="true">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="skeleton" />
      ))}
    </div>
  );
}
