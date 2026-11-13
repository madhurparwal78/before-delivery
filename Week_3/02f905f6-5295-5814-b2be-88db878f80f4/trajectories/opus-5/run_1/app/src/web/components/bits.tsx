import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { FiringStatus, PieceStatus } from '../../shared/types';
import { conePosture } from '../../shared/labels';

/** A drawn pyrometric cone: upright before the heat, bent after it. */
export function ConeGlyph({ status }: { status: PieceStatus | FiringStatus }): JSX.Element {
  const bent = conePosture(status) === 'bent';
  return (
    <svg
      className="cone-glyph"
      width="14"
      height="18"
      viewBox="0 0 14 18"
      aria-hidden="true"
      focusable="false"
    >
      {bent ? (
        <path d="M2 17 L4 6 Q5 2 11 4 L12 6 L5 8 L6 17 Z" fill="currentColor" />
      ) : (
        <path d="M4 17 L7 1 L10 17 Z" fill="currentColor" />
      )}
    </svg>
  );
}

/** A status always reads as words beside its cone, never colour alone. */
export function StatusLabel({
  status,
  label,
}: {
  status: PieceStatus | FiringStatus;
  label: string;
}): JSX.Element {
  return (
    <span className="status-line">
      <ConeGlyph status={status} />
      <span>{label}</span>
    </span>
  );
}

export type LiveTone = 'idle' | 'pending' | 'good' | 'bad';

export interface LiveMessage {
  text: string;
  tone: LiveTone;
}

export const quiet: LiveMessage = { text: '', tone: 'idle' };

/** A named live region that keeps its last message until the next action. */
export function LiveRegion({
  name,
  message,
  as = 'status',
}: {
  name: string;
  message: LiveMessage;
  as?: 'status' | 'alert';
}): JSX.Element {
  return (
    <span
      role={as}
      aria-label={name}
      aria-live={as === 'alert' ? 'assertive' : 'polite'}
      className={`live ${message.tone}`}
    >
      {message.text}
    </span>
  );
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const listener = (): void => setReduced(query.matches);
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
  }, []);
  return reduced;
}

/** Counts whole percents to a new value, or jumps when motion is reduced. */
export function useCountTo(target: number, reduced: boolean): number {
  const [shown, setShown] = useState(target);
  const shownRef = useRef(target);
  const frame = useRef<number | null>(null);
  shownRef.current = shown;
  useEffect(() => {
    if (reduced) {
      setShown(target);
      return;
    }
    const from = shownRef.current;
    if (from === target) return;
    const steps = Math.abs(target - from);
    const duration = 600;
    const started = performance.now();
    const tick = (): void => {
      const progress = Math.min(1, (performance.now() - started) / duration);
      const done = Math.round(progress * steps);
      setShown(from + Math.sign(target - from) * done);
      if (progress < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [target, reduced]);
  return shown;
}

/** A modal dialog that keeps focus inside and closes on Escape. */
export function Dialog({
  name,
  onClose,
  children,
}: {
  name: string;
  onClose: () => void;
  children: ReactNode;
}): JSX.Element {
  const box = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const first = box.current?.querySelector<HTMLElement>(
      'input, select, textarea, button, [href]',
    );
    first?.focus();
  }, []);

  const focusable = (): HTMLElement[] =>
    Array.from(
      box.current?.querySelectorAll<HTMLElement>(
        'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href]',
      ) ?? [],
    );

  return (
    <div className="scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={name}
        ref={box}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
            return;
          }
          if (event.key !== 'Tab') return;
          const items = focusable();
          const first = items[0];
          const last = items[items.length - 1];
          if (!first || !last) return;
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** An error summary whose lines move focus to the field they name. */
export function ErrorSummary({
  fields,
  labels,
}: {
  fields: Record<string, string>;
  labels: Record<string, string>;
}): JSX.Element | null {
  const entries = Object.entries(fields);
  if (entries.length === 0) return null;
  return (
    <div role="alert" className="alert">
      <h3>Check these fields</h3>
      <ul>
        {entries.map(([field, message]) => (
          <li key={field}>
            <a
              href={`#field-${field}`}
              onClick={(event) => {
                event.preventDefault();
                document.getElementById(`field-${field}`)?.focus();
              }}
            >
              {labels[field] ?? field}: {message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A photo on its darker mat, with the outage copy when it cannot be read. */
export function PhotoMat({
  photoId,
  caption,
  alt,
}: {
  photoId: string | null;
  caption: string;
  alt: string;
}): JSX.Element {
  const [failed, setFailed] = useState(false);
  return (
    <figure className="photo-mat">
      {photoId && !failed ? (
        <img src={`/api/photos/${photoId}`} alt={alt} onError={() => setFailed(true)} />
      ) : (
        <p>Photo unavailable while storage is down.</p>
      )}
      <figcaption className="mono">{caption}</figcaption>
    </figure>
  );
}
