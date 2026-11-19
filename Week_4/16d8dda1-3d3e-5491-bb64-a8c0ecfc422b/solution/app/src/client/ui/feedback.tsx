import type { ReactNode } from 'react';
import { Link } from '../router';
import { EmptyDrawing, Icon } from './icons';

/** A refusal or failure: ink text with a slate rule. The text node is exactly what the caller passes. */
export function Alert({ children }: { children: ReactNode }) {
  return (
    <div className="alert" role="alert">
      <Icon name="warning" size={18} />
      <span>{children}</span>
    </div>
  );
}

/** The page's one polite status line for pending and success copy. Always mounted so changes are announced. */
export function PageStatus({ text }: { text: string }) {
  return (
    <p className="page-status" role="status" aria-label="Page status">
      {text}
    </p>
  );
}

export function Empty({ drawing, children }: { drawing: 'tray' | 'quill' | 'seats'; children: ReactNode }) {
  return (
    <div className="empty">
      <EmptyDrawing kind={drawing} />
      <p>{children}</p>
    </div>
  );
}

/** Ruled placeholder at the final height while the first request is in flight. */
export function Skeleton({ rows = 3, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div className="skeleton" aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }, (_, index) => (
        <div className="skeleton-row" key={index} />
      ))}
    </div>
  );
}

export function NotFound() {
  return (
    <main className="page narrow">
      <h1>Page not found</h1>
      <p>We couldn't find that page.</p>
      <p>
        <Link href="/">Back to the start</Link>
      </p>
    </main>
  );
}
