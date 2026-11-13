import type { ReactNode } from "react";
import { NOT_AVAILABLE_COPY } from "../lib/copy";

/** A small drawn blank-calendar mark for empty lists. */
function EmptyMark() {
  return (
    <svg className="empty-mark" viewBox="0 0 48 48" width="48" height="48" aria-hidden="true" focusable="false">
      <rect x="5" y="9" width="38" height="34" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <path d="M5 19h38M15 4v10M33 4v10" stroke="currentColor" strokeWidth="2.5" fill="none" />
      <path d="M13 28h6M21 28h6M29 28h6M13 36h6M21 36h6" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

export function EmptyRow({ children }: { children: ReactNode }) {
  return (
    <div className="empty-row">
      <EmptyMark />
      <p>{children}</p>
    </div>
  );
}

export function LoadingRows() {
  return (
    <div className="loading-rows mono" aria-hidden="true">
      <div className="loading-row">Loading…</div>
      <div className="loading-row">Loading…</div>
    </div>
  );
}

export function NotAvailable() {
  return (
    <section className="detail detail--empty" aria-label="Assignment unavailable">
      <p className="not-available">{NOT_AVAILABLE_COPY}</p>
    </section>
  );
}
