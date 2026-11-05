// An empty booklet slip with a small drawn shelf, saying what happens next.
export function EmptySlip({ children }: { children: string }) {
  return (
    <div className="empty">
      <svg width="96" height="48" viewBox="0 0 96 48" aria-hidden="true" focusable="false">
        <ellipse cx="48" cy="34" rx="40" ry="9" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <rect x="14" y="20" width="4" height="14" fill="currentColor" opacity="0.5" />
        <rect x="78" y="20" width="4" height="14" fill="currentColor" opacity="0.5" />
        <path d="M44 32 L47 14 L50 32 Z" fill="currentColor" opacity="0.7" />
      </svg>
      <p>{children}</p>
    </div>
  );
}
