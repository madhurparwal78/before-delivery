import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ICON_BODIES, type IconName } from '../icons/generated.js';
import { dialogIn, meterFill, rollDigits } from '../lib/motion.js';

/** Lucide icons, at one stroke weight throughout. */
export function Icon({ name }: { name: IconName }): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      dangerouslySetInnerHTML={{ __html: ICON_BODIES[name] }}
    />
  );
}

/**
 * A number whose digits roll to each new value, while the accessible text already holds the
 * final value.
 */
export function Ticker({ value, className }: { value: number | string; className?: string }): JSX.Element {
  const text = String(value);
  const ref = useRef<HTMLSpanElement>(null);
  const previous = useRef(text);

  useLayoutEffect(() => {
    if (previous.current !== text && ref.current) rollDigits(ref.current, previous.current, text);
    previous.current = text;
  }, [text]);

  return (
    <span className={className} ref={ref}>
      <span aria-hidden="true">
        {[...text].map((character, index) => (
          <span data-digit key={`${index}-${character}`} style={{ display: 'inline-block' }}>
            {character}
          </span>
        ))}
      </span>
      <span className="visually-hidden">{text}</span>
    </span>
  );
}

export function Meter({ label, used, cap }: { label: string; used: number; cap: number | null }): JSX.Element {
  const ratio = cap === null || cap === 0 ? 0 : Math.min(1, used / cap);
  const barRef = useRef<HTMLSpanElement>(null);
  const previousRatio = useRef(ratio);

  useLayoutEffect(() => {
    if (barRef.current && previousRatio.current !== ratio) {
      meterFill(barRef.current, previousRatio.current, ratio);
    }
    previousRatio.current = ratio;
  }, [ratio]);

  const text = cap === null ? `${label} — ${used}, unlimited` : `${label} — ${used} of ${cap}`;
  return (
    <li>
      <div
        role="meter"
        aria-label={label}
        aria-valuenow={used}
        aria-valuemin={0}
        {...(cap === null ? {} : { 'aria-valuemax': cap })}
        aria-valuetext={text}
      >
        <span className="mono">{text}</span>
        <span className="meter-track" aria-hidden="true">
          <span className="meter-bar" ref={barRef} style={{ transform: `scaleX(${ratio})` }} />
        </span>
      </div>
    </li>
  );
}

export interface ModalProps {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}

/**
 * A dialog that traps focus while open, closes on Escape and returns focus to the control
 * that opened it.
 */
export function Modal({ title, onClose, children }: ModalProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    opener.current = document.activeElement;
    const node = ref.current;
    if (node) {
      dialogIn(node);
      focusablesOf(node)[0]?.focus();
    }
    return () => {
      const previous = opener.current;
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !ref.current) return;
      const focusables = focusablesOf(ref.current);
      if (focusables.length === 0) return;
      const first = focusables[0] as HTMLElement;
      const last = focusables[focusables.length - 1] as HTMLElement;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  return (
    <div className="modal-scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

function focusablesOf(root: HTMLElement): HTMLElement[] {
  return [
    ...root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ];
}

/** A polite status region and an assertive alert region, present from load. */
export function LiveRegions({
  statusLabel,
  alertLabel,
  status,
  problem,
  extra,
}: {
  statusLabel: string;
  alertLabel: string;
  status: string;
  problem: string;
  extra?: ReactNode;
}): JSX.Element {
  return (
    <>
      <div role="status" aria-live="polite" aria-label={statusLabel} className="status-line">
        {status}
        {extra}
      </div>
      <div role="alert" aria-live="assertive" aria-label={alertLabel} className="status-line problem">
        {problem}
      </div>
    </>
  );
}
