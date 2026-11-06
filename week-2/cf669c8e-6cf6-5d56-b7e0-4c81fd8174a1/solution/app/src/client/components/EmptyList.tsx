import type { ReactNode } from 'react';

/** The published empty wording with a small line drawing of an empty sheet. */
export function EmptyList({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="empty-list">
      <svg viewBox="0 0 96 72" width="96" height="72" aria-hidden="true" focusable="false">
        <rect x="14" y="6" width="68" height="60" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M24 20h48M24 30h48M24 40h30" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3" />
        <path d="M62 52l6 6 10-12" fill="none" stroke="var(--accent)" strokeWidth="2" />
      </svg>
      <p>{children}</p>
    </div>
  );
}
