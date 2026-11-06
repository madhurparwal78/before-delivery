// Shared interface pieces: the two live regions, busy buttons, fields with their API messages,
// the action runner behind every published pending/success/error copy, and count-up numerals.
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { ApiFailure } from './api';
import { failureCopy, fmt, OUTAGE } from './copy';
import { TideLine } from './icons';
import { notify, reducedMotion, state, subscribe, warn } from './store';

/** Re-renders the caller whenever the store changes. */
/** A function that re-renders the caller. */
export function useRerender(): () => void {
  const [, set] = useState(0);
  return () => set((n) => n + 1);
}

/** Re-renders the caller whenever the store changes. */
export function useStore(): typeof state {
  const rerender = useRerender();
  useLayoutEffect(() => subscribe(rerender), []);
  return state;
}

export function LiveRegions() {
  const s = useStore();
  return (
    <div class="toasts">
      <div role="status" aria-label="Tide notices" aria-live="polite">
        {s.notice && (
          <p key={s.notice.key} class={`toast ${s.notice.tone}`}>
            {s.notice.text}
          </p>
        )}
      </div>
      <div role="alert" aria-label="Tide alerts" aria-live="assertive" class="alert">
        {s.alert && (
          <p key={s.alert.key} class="toast danger">
            {s.alert.text}
          </p>
        )}
      </div>
    </div>
  );
}

export function OutageBanner() {
  const s = useStore();
  return s.outage ? (
    <div class="banner" aria-hidden="true">
      {OUTAGE}
    </div>
  ) : null;
}

export type FieldErrors = Record<string, string>;

interface ActionSpec<T> {
  pending?: string;
  run: () => Promise<T>;
  success?: (result: T) => string | null;
  errors?: Record<string, string | ((f: ApiFailure) => string)>;
  fields?: (errors: FieldErrors) => void;
}

/**
 * Runs one async action with its published copy: the pending copy to Tide notices, success to
 * Tide notices, errors to Tide alerts, and validation messages back to the form's fields.
 */
export async function perform<T>(spec: ActionSpec<T>): Promise<T | undefined> {
  if (spec.pending) notify(spec.pending);
  spec.fields?.({});
  try {
    const result = await spec.run();
    const copy = spec.success?.(result);
    if (copy) notify(copy);
    return result;
  } catch (error) {
    if (error instanceof ApiFailure && error.code === 'unauthenticated') return undefined;
    if (error instanceof ApiFailure && error.code === 'validation_failed') spec.fields?.(error.body?.errors ?? {});
    warn(failureCopy(error, spec.errors));
    return undefined;
  }
}

/** A busy flag for one control: while an action runs, presses are ignored. */
export function useBusy(): [boolean, <T>(spec: ActionSpec<T>) => Promise<T | undefined>] {
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const mounted = useRef(true);
  useEffect(() => () => void (mounted.current = false), []);
  const run = async <T,>(spec: ActionSpec<T>): Promise<T | undefined> => {
    if (running.current) return undefined;
    running.current = true;
    setBusy(true);
    try {
      return await perform(spec);
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return [busy, run];
}

type ButtonProps = JSX.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean; variant?: 'primary' | 'quiet' | 'danger' | '' };

export function Button({ busy = false, variant = '', class: extra, children, ...rest }: ButtonProps) {
  return (
    <button type="button" class={`btn ${variant} ${(extra as string | undefined) ?? ''}`} aria-busy={busy ? 'true' : undefined} {...rest}>
      {children}
    </button>
  );
}

interface FieldProps {
  id: string;
  label: string;
  error?: string | undefined;
  children?: ComponentChildren;
}

/** A labelled control whose API message sits directly under it and is its accessible description. */
export function Field({ id, label, error, children }: FieldProps) {
  return (
    <div class="field">
      <label for={id}>{label}</label>
      {children}
      {error && (
        <p class="field-error" id={`${id}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}

/** Props that mark a control invalid and point at its message. */
export function invalid(id: string, error: string | undefined): Record<string, string | undefined> {
  return error ? { 'aria-invalid': 'true', 'aria-describedby': `${id}-error` } : { 'aria-invalid': undefined, 'aria-describedby': undefined };
}

const COUNT_MS = 250;
const GLOW_MS = 700;

/** A tabular numeral that counts from its old value to a new one and briefly turns orange. */
export function Num({ value, format = fmt }: { value: number; format?: (n: number) => string }) {
  const [shown, setShown] = useState(value);
  const [glow, setGlow] = useState(false);
  const from = useRef(value);
  useEffect(() => {
    if (from.current === value) return undefined;
    const start = from.current;
    from.current = value;
    if (reducedMotion()) {
      setShown(value);
      return undefined;
    }
    setGlow(true);
    const began = performance.now();
    let frame = 0;
    const step = (): void => {
      const t = Math.min(1, (performance.now() - began) / COUNT_MS);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(t >= 1 ? value : Math.round(start + (value - start) * eased));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    const timer = window.setTimeout(() => setGlow(false), GLOW_MS);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      setShown(value);
    };
  }, [value]);
  return <span class={glow ? 'num changed' : 'num'}>{format(shown)}</span>;
}

export function Empty({ children }: { children: ComponentChildren }) {
  return (
    <p class="empty">
      <TideLine />
      {children}
    </p>
  );
}
