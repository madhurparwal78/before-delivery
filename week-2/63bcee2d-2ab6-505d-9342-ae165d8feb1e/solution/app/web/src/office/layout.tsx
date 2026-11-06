import { useState, type ReactNode } from "react";
import { formatDate, zoneToday } from "../../../shared/format";

// Office building blocks: the drawing title block, an action button with its pending copy, the phone
// sticky action bar and a scrollable table region.

/** A panel's title block in small capitals: sheet code, revision and today's date in Hong Kong. */
export function TitleBlock({ code, name, revision }: { code: string; name: string; revision: string }) {
  return (
    <div className="title-block">
      <span><span className="label">Sheet</span> {code}</span>
      <span>{name}</span>
      <span><span className="label">Rev</span> {revision}</span>
      <span>{formatDate(zoneToday("Asia/Hong_Kong"))}</span>
    </div>
  );
}

interface ActionButtonProps {
  /** The visible label and accessible name. */
  children: ReactNode;
  /** The pending copy shown while the action runs. */
  pending: string;
  onAction: () => Promise<unknown>;
  primary?: boolean;
  type?: "button" | "submit";
  id?: string;
}

/**
 * A button that shows its pending copy and refuses further presses while its action runs.
 * It stays focusable (aria-disabled) so focus is never lost to the page.
 */
export function ActionButton({ children, pending, onAction, primary, type = "button", id }: ActionButtonProps) {
  const [busy, setBusy] = useState(false);
  const run = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await onAction();
    } finally {
      setBusy(false);
    }
  };
  return (
    <button id={id} type={type} className={primary ? "button button-primary" : "button"} aria-disabled={busy || undefined}
      onClick={(event) => {
        event.preventDefault();
        void run();
      }}>
      {busy ? pending : children}
    </button>
  );
}

/** The phone-only sticky bar carrying the screen's primary action. */
export function StickyBar({ children }: { children: ReactNode }) {
  return <div className="action-bar">{children}</div>;
}

/** A bordered region a wide table scrolls sideways inside. */
export function TableRegion({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`table-region${className ? ` ${className}` : ""}`} role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}

/** Moves focus to an element by id once it is in the document. */
export function focusId(id: string): void {
  document.getElementById(id)?.focus();
}

/** A stable, id-safe slug of a label, for focus targets such as headings named after records. */
export const domId = (prefix: string, value: string): string => `${prefix}-${value.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
