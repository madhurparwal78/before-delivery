import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { useTypedLine } from '../lib/typing.js';

/** The letters of a typed line, each hidden from the accessibility tree. */
export function CueLine({
  text,
  reducedMotion,
  level = 1,
  className = 'cue-line',
}: {
  text: string;
  reducedMotion: boolean;
  level?: 1 | 2;
  className?: string;
}): JSX.Element {
  const line = useTypedLine(text, reducedMotion);
  const Heading = level === 1 ? 'h1' : 'h2';
  const lastVisible = line.typed - 1;
  return (
    <Heading className={className} aria-label={text} data-typed={String(line.typed)}>
      <span aria-hidden="true">
        {Array.from(text).map((character, index) => (
          <span key={index}>
            <span className="cue-letter" data-letter={line.letters[index] ?? 'hidden'}>
              {character === ' ' ? '\u00a0' : character}
            </span>
            {index === lastVisible ? <GuideCursor /> : null}
          </span>
        ))}
        {line.typed === 0 ? <GuideCursor /> : null}
      </span>
    </Heading>
  );
}

/** The decorative Spindrift guide cursor, hidden from the accessibility tree. */
export function GuideCursor(): JSX.Element {
  return (
    <span className="guide-cursor" aria-hidden="true">
      <span className="arrow-head" />
      <span className="tag">SPINDRIFT</span>
    </span>
  );
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A dialog that keeps Tab inside, closes with Escape and returns focus to the
 * control that opened it. When closed nothing inside it exists.
 */
export function Dialog({
  title,
  onClose,
  closeLabel,
  children,
  variant = 'panel',
}: {
  title: string;
  onClose: () => void;
  closeLabel: string;
  children: ReactNode;
  variant?: 'panel' | 'drawer' | 'case-study' | 'bottom';
}): JSX.Element {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<Element | null>(null);
  const titleId = useId();

  useEffect(() => {
    openerRef.current = document.activeElement;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();
    return () => {
      const opener = openerRef.current;
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (element) => element.offsetParent !== null || element === document.activeElement,
    );
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const isBottom = variant === 'bottom';
  return (
    <div className={`scrim${isBottom ? ' bottom' : ''}`} onKeyDown={onKeyDown}>
      <div
        ref={panelRef}
        className={`dialog ${variant === 'panel' ? '' : variant}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="spread">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="chip-chrome" onClick={onClose}>
            {closeLabel}
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Table({
  name,
  head,
  children,
}: {
  name: string;
  head: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="table-scroll" role="group" aria-label={name}>
      <table aria-label={name}>
        <caption>{name}</caption>
        <thead>{head}</thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/** A total whose digits roll to their new value; the text is final at once. */
export function RollingAmount({
  amount,
  reducedMotion,
}: {
  amount: string;
  reducedMotion: boolean;
}): JSX.Element {
  return (
    <span className="numeral" aria-label={amount}>
      {Array.from(amount).map((character, index) =>
        /\d/.test(character) ? (
          <Reel key={index} digit={Number(character)} reducedMotion={reducedMotion} />
        ) : (
          <span key={index} aria-hidden="true">
            {character}
          </span>
        ),
      )}
    </span>
  );
}

function Reel({ digit, reducedMotion }: { digit: number; reducedMotion: boolean }): JSX.Element {
  return (
    <span className="rolling" aria-hidden="true">
      <span
        className="reel"
        style={{
          transform: `translateY(${-digit * 1.2}em)`,
          ...(reducedMotion ? { transition: 'none' } : {}),
        }}
      >
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((value) => (
          <span key={value}>{value}</span>
        ))}
      </span>
    </span>
  );
}

export function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string | undefined;
  children: ReactNode;
}): JSX.Element {
  return (
    <div>
      <label>{label}</label>
      {children}
      {error ? <p className="muted">{error}</p> : null}
    </div>
  );
}

/** The error summary whose entries link to their fields. */
export function Problems({ errors }: { errors: Record<string, string> }): JSX.Element | null {
  const entries = Object.entries(errors);
  if (entries.length === 0) return null;
  return (
    <section className="notice" role="region" aria-label="Problems">
      <ul className="list">
        {entries.map(([field, message]) => (
          <li key={field}>
            <a href={`#field-${field}`}>{message}</a>
          </li>
        ))}
      </ul>
    </section>
  );
}
