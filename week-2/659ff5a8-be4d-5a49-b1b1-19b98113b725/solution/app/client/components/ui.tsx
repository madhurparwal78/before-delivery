import type { ReactNode } from "react";

/** The drawn cone: a squared base, a tapered body and two reflective bands, in ink. */
export function ConeMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="cone-mark">
      <path d="M3 21h18" stroke="currentColor" strokeWidth="2" strokeLinecap="square" />
      <path d="M9.2 4.5h5.6L18 19.5H6z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="miter" />
      <path d="M8 11h8M7 15.2h10" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

/**
 * A named polite live region that is always in the page; empty it is read as nothing. Screens whose updates stream in
 * while the user works (`reserve`) keep its room, so an arriving line never moves the rows under the eye or the finger.
 */
export function StatusRegion({ name, reserve = false, children }: { name: string; reserve?: boolean; children?: ReactNode }) {
  const state = `${reserve ? " reserved" : ""}${children ? "" : " idle"}`;
  return (
    <div role="status" aria-label={name} className={`status-line${state}`}>
      {children}
    </div>
  );
}

/** A one-line statement and, when there is one, the next step. */
export function EmptyState({ children, next }: { children: ReactNode; next?: ReactNode }) {
  return (
    <div className="empty">
      <svg width="48" height="48" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
        <path d="M6 40h36" stroke="currentColor" strokeWidth="2" />
        <path d="M19 9h10l6 28H13z" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M16 21h16M14.5 29h19" stroke="currentColor" strokeWidth="1.6" />
      </svg>
      <p className="empty-title">{children}</p>
      {next ? <p>{next}</p> : null}
    </div>
  );
}

export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="skeleton" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="skeleton-row" />
      ))}
    </div>
  );
}

export function LoadFailed({ retry }: { retry: () => void }) {
  return (
    <div className="empty">
      <p>Could not load this screen. Try again.</p>
      <button type="button" className="btn btn-secondary" onClick={retry}>
        Try again
      </button>
    </div>
  );
}

/** A wide table scrolls inside its own keyboard-reachable box, never the page. */
export function ScrollBox({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="table-wrap" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}
