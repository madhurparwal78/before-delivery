import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiOutcome } from './api';
import { errorCode } from './api';
import { useSession } from './session';

export type StatusKind = 'idle' | 'pending' | 'success' | 'error';

export interface StatusHandle {
  readonly text: string;
  readonly kind: StatusKind;
  pending(text: string): void;
  success(text: string): void;
  error(text: string): void;
  /** Shows a change found by a re-read, once. */
  announceOnce(token: string, text: string): void;
  clear(): void;
}

/** One status region: its text appears on screen and is announced once. */
export function useStatus(): StatusHandle {
  const [state, setState] = useState<{ text: string; kind: StatusKind }>({
    text: '',
    kind: 'idle',
  });
  const announced = useRef<string | null>(null);
  const kindRef = useRef<StatusKind>('idle');
  kindRef.current = state.kind;

  const pending = useCallback((text: string) => setState({ text, kind: 'pending' }), []);
  const success = useCallback((text: string) => setState({ text, kind: 'success' }), []);
  const error = useCallback((text: string) => setState({ text, kind: 'error' }), []);
  const clear = useCallback(() => setState({ text: '', kind: 'idle' }), []);
  const announceOnce = useCallback((token: string, text: string) => {
    if (announced.current === token) return;
    announced.current = token;
    // An error result stays until the user's next action.
    if (kindRef.current === 'error') return;
    setState({ text, kind: 'success' });
  }, []);

  return { text: state.text, kind: state.kind, pending, success, error, announceOnce, clear };
}

export interface SubmitOptions<T> {
  readonly status: StatusHandle;
  readonly pendingText: string;
  /** Held from the first press until the server answers. */
  readonly idempotent?: boolean;
  readonly noAnswerText?: string;
  onOk(body: T, outcome: Extract<ApiOutcome<T>, { kind: 'ok' }>): void;
  onError(outcome: ApiOutcome<T>): void;
}

export interface SubmitHandle<T> {
  readonly busy: boolean;
  readonly key: string | null;
  run(send: (key: string | null) => Promise<ApiOutcome<T>>): Promise<void>;
  /** Drops the held key, for example when the form closes. */
  reset(): void;
}

/**
 * Runs one async action: pending copy, then the server's answer. Four forms hold an
 * idempotency key until an answer arrives, and resend once after a session expiry.
 */
export function useSubmit<T>(options: SubmitOptions<T>): SubmitHandle<T> {
  const { markInterrupted } = useSession();
  const [busy, setBusy] = useState(false);
  const keyRef = useRef<string | null>(null);
  const lastSend = useRef<((key: string | null) => Promise<ApiOutcome<T>>) | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const run = useCallback(
    async (send: (key: string | null) => Promise<ApiOutcome<T>>): Promise<void> => {
      const settings = optionsRef.current;
      if (settings.idempotent === true && keyRef.current === null) {
        keyRef.current = crypto.randomUUID();
      }
      lastSend.current = send;
      setBusy(true);
      settings.status.pending(settings.pendingText);
      const outcome = await send(keyRef.current);
      setBusy(false);

      if (outcome.kind === 'no-answer') {
        if (settings.noAnswerText !== undefined) settings.status.error(settings.noAnswerText);
        else settings.status.error('No answer from the server.');
        return;
      }
      if (outcome.kind === 'error') {
        if (outcome.status === 401 && errorCode(outcome) === 'session_expired') {
          if (settings.idempotent === true) {
            markInterrupted({
              resend: () => {
                void run(send);
              },
              notResent: null,
            });
          } else {
            markInterrupted({
              resend: null,
              notResent: () => settings.status.error(NOT_RESENT),
            });
          }
          return;
        }
        keyRef.current = null;
        settings.onError(outcome);
        return;
      }
      keyRef.current = null;
      settings.onOk(outcome.body, outcome);
    },
    [markInterrupted],
  );

  const reset = useCallback(() => {
    keyRef.current = null;
  }, []);

  return { busy, key: keyRef.current, run, reset };
}

const NOT_RESENT = 'Signed in again. Nothing was saved; press again.';

/** Periodic re-reads that update values in place, paused only while Sign in again is open. */
export function useReread(load: () => Promise<void>, intervalMs: number, enabled = true): void {
  const { signInAgainOpen } = useSession();
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (!enabled || signInAgainOpen || intervalMs <= 0) return;
    let stopped = false;
    let timer: number | undefined;
    const tick = async (): Promise<void> => {
      await loadRef.current();
      if (stopped) return;
      timer = window.setTimeout(() => void tick(), intervalMs);
    };
    timer = window.setTimeout(() => void tick(), intervalMs);
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [enabled, signInAgainOpen, intervalMs]);
}

/** The first load of a screen's data. */
export function useFirstLoad(load: () => Promise<void>): void {
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    void loadRef.current();
  }, []);
}

export function useMediaQuery(queryText: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(queryText).matches);
  useEffect(() => {
    const media = window.matchMedia(queryText);
    const update = (): void => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [queryText]);
  return matches;
}

export function useReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}

export function useIsNarrow(): boolean {
  return !useMediaQuery('(min-width: 768px)');
}
