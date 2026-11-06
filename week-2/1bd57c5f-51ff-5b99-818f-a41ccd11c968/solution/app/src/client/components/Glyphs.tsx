import type { ItemStatus, JobStatus } from "../../shared/domain";

// Small drawn marks in the plan's own line language. All decorative: the words beside them carry the meaning.

export function StatusGlyph({ status }: { status: ItemStatus }) {
  return (
    <svg className="glyph" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      {status === "ready_for_check" ? (
        <rect x="1" y="1" width="8" height="8" fill="#2c5a85" />
      ) : (
        <circle cx="5" cy="5" r="4" fill={status === "verified" ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5" />
      )}
      {status === "in_progress" && <path d="M5 1a4 4 0 0 1 0 8z" fill="currentColor" />}
    </svg>
  );
}

export function StageGlyph({ status }: { status: JobStatus }) {
  return (
    <svg className="glyph" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <circle cx="5" cy="5" r="4" fill={status === "closed_out" ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5" />
      {status === "walkthrough" && <path d="M5 1a4 4 0 0 1 0 8z" fill="currentColor" />}
    </svg>
  );
}

export function BrandMark() {
  return (
    <svg className="brand-mark" width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
      <rect x="1.5" y="1.5" width="25" height="25" fill="none" stroke="#24262a" strokeWidth="1.5" />
      <path d="M1.5 10h25M1.5 18h25M10 1.5v25M18 1.5v25" stroke="#2c5a85" strokeOpacity="0.35" strokeWidth="1" />
      <circle cx="18" cy="10" r="5" fill="#f06a1d" stroke="#24262a" strokeWidth="1.5" />
    </svg>
  );
}

export function EmptyGlyph() {
  return (
    <svg width="40" height="28" viewBox="0 0 40 28" aria-hidden="true">
      <rect x="1.5" y="1.5" width="37" height="25" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3" />
      <path d="M8 21h10M8 17h16" stroke="currentColor" strokeOpacity="0.45" strokeWidth="1.5" />
    </svg>
  );
}

export function CrosshairGlyph() {
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="12" fill="none" stroke="#24262a" strokeWidth="4" />
      <circle cx="32" cy="32" r="12" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <path d="M32 2v18M32 44v18M2 32h18M44 32h18" stroke="#24262a" strokeWidth="4" />
      <path d="M32 2v18M32 44v18M2 32h18M44 32h18" stroke="currentColor" strokeWidth="2" />
      <circle cx="32" cy="32" r="2" fill="#24262a" />
    </svg>
  );
}
