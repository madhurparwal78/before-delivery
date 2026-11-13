/** Shared controls: dialogs that trap focus, buttons that wait, and money that rolls. */

import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { formatAmount } from '../../shared/format.js';
import { useReducedMotion } from '../state.tsx';

function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = (): void => setMatches(list.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/** Desktop layout starts at 1200 px; tablet layout at 768 px. */
export const useDesktop = (): boolean => useMedia('(min-width: 1200px)');
export const useWideViewport = (): boolean => useMedia('(min-width: 768px)');

export function Amount({ paise }: { paise: number }): ReactNode {
  return <>{formatAmount(paise)}</>;
}


export function Spinner(): ReactNode {
  return (
    <span className="spinner" aria-hidden="true">
      ·
    </span>
  );
}

export function PendingButton({
  label,
  onPress,
  className,
  disabled,
  type,
}: {
  label: string;
  onPress: () => void | Promise<unknown>;
  className?: string;
  disabled?: boolean;
  type?: 'button' | 'submit';
}): ReactNode {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type={type ?? 'button'}
      className={className ?? 'btn'}
      disabled={busy || disabled === true}
      onClick={() => {
        setBusy(true);
        void Promise.resolve(onPress()).finally(() => setBusy(false));
      }}
    >
      {label}
      {busy ? <Spinner /> : null}
    </button>
  );
}

export function StatusRegion({
  name,
  message,
  alert,
}: {
  name: string;
  message: string;
  alert?: boolean;
}): ReactNode {
  return (
    <div
      role={alert === true ? 'alert' : 'status'}
      aria-label={name}
      aria-live={alert === true ? 'assertive' : 'polite'}
      className={message === '' ? 'muted' : 'panel panel-black'}
    >
      {message}
    </div>
  );
}

/** A modal that moves focus in, wraps Tab inside, closes on Escape and gives focus back. */
export function Dialog({
  name,
  open,
  onClose,
  children,
}: {
  name: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}): ReactNode {
  const panel = useRef<HTMLDivElement | null>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    const focusables = panel.current?.querySelectorAll<HTMLElement>(
      'input, select, textarea, button, a[href], [tabindex]:not([tabindex="-1"])',
    );
    focusables?.[0]?.focus();
    return () => {
      (opener.current as HTMLElement | null)?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="dialog-layer"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(8,8,12,0.72)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 70,
        padding: 16,
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
          return;
        }
        if (event.key !== 'Tab') return;
        const items = [
          ...(panel.current?.querySelectorAll<HTMLElement>(
            'input:not([disabled]), select, textarea, button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
          ) ?? []),
        ];
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={name}
        className="panel"
        ref={panel}
        style={{ width: 'min(560px, 94vw)', maxHeight: '86vh', overflowY: 'auto' }}
      >
        <h3>{name.toLowerCase()}</h3>
        {children}
      </div>
    </div>
  );
}

/** Digits that roll to the server's value, with the final value always as the text. */
export function Reel({
  paise,
  className,
}: {
  paise: number;
  className?: string;
}): ReactNode {
  const reduced = useReducedMotion();
  const text = formatAmount(paise);
  const characters = [...text];
  const digitCount = characters.filter((character) => /[0-9]/.test(character)).length;
  let seen = 0;
  return (
    <span className={`amount-reel ${className ?? ''}`} key={reduced ? text : `${text}-roll`}>
      {characters.map((character, index) => {
        const isDigit = /[0-9]/.test(character);
        if (isDigit) seen += 1;
        const delay = reduced ? 0 : (digitCount - seen) * 40;
        return (
          <span
            key={`${index}-${character}`}
            className={isDigit && !reduced ? 'digit' : undefined}
            style={isDigit && !reduced ? ({ ['--delay']: `${delay}ms` } as React.CSSProperties) : undefined}
          >
            {character}
          </span>
        );
      })}
    </span>
  );
}

export function CountedField({
  label,
  value,
  max,
  onChange,
  onBlur,
  multiline,
}: {
  label: string;
  value: string;
  max: number;
  onChange: (value: string) => void;
  onBlur?: () => void;
  multiline?: boolean;
}): ReactNode {
  const id = useId();
  const used = [...value].length;
  return (
    <div>
      <label htmlFor={id}>{label}</label>
      {multiline === true ? (
        <textarea
          id={id}
          aria-label={label}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
        />
      ) : (
        <input
          id={id}
          type="text"
          aria-label={label}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
        />
      )}
      <span className="counter">{`${used}/${max}`}</span>
    </div>
  );
}

/** A countdown computed from the end time and the server time the API returned. */
export function useCountdown(endsAt: string | null, serverTime: string | null): number {
  const [left, setLeft] = useState(0);
  const offset = useRef(0);

  useEffect(() => {
    if (serverTime !== null) {
      offset.current = new Date(serverTime).getTime() - Date.now();
    }
  }, [serverTime]);

  useEffect(() => {
    if (endsAt === null) {
      setLeft(0);
      return;
    }
    const end = new Date(endsAt).getTime();
    const tick = (): void => {
      setLeft(Math.max(0, Math.ceil((end - (Date.now() + offset.current)) / 1000)));
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [endsAt]);

  return left;
}

export function Timer({ name, seconds }: { name: string; seconds: number }): ReactNode {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return (
    <span role="timer" aria-label={name} aria-live="off" className="chip">
      {minutes > 0 ? `${minutes}m ${String(rest).padStart(2, '0')}s` : `${rest}s`}
    </span>
  );
}
