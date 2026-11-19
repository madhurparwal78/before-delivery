import type { ComponentChildren, JSX } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { api, ApiError, refuse } from '../api.ts';
import { navigate } from '../router.tsx';
import { actionStatus } from '../store.ts';

// Helpers for the account, list and settings screens. No useEffect and no timers: page timers
// are paused in the test browsers, so loading runs from layout effects and promises only.

interface Loaded<T> {
  data: T | null;
  error: ApiError | null;
  reload: () => Promise<void>;
}

/** Loads on mount (and whenever `key` changes); a 401 goes to the login screen. */
export function useLoad<T>(load: () => Promise<T>, key: string): Loaded<T> {
  const [state, setState] = useState<{ data: T | null; error: ApiError | null }>({ data: null, error: null });
  const latest = useRef(load);
  latest.current = load;
  const run = async (): Promise<void> => {
    try {
      setState({ data: await latest.current(), error: null });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) navigate('/login', true);
      else setState({ data: null, error: error instanceof ApiError ? error : new ApiError(500, {}) });
    }
  };
  useLayoutEffect(() => {
    setState({ data: null, error: null });
    void run();
  }, [key]);
  return { ...state, reload: run };
}

let counter = 0;
const nextId = (): string => `f${(counter += 1)}`;

type InputProps = Omit<JSX.IntrinsicElements['input'], 'ref' | 'onInput' | 'value'>;

/** A labelled input; the error sits next to the field, outside the label so the name stays exact. */
export function TextField({ label, value, onValue, error, children, ...rest }: InputProps & { label: string; value: string; onValue: (value: string) => void; error?: string | null; children?: ComponentChildren }) {
  const id = useRef(nextId()).current;
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>{label}</label>
      <input {...rest} id={id} value={value} onInput={(event) => onValue((event.target as HTMLInputElement).value)} aria-describedby={error ? `${id}-error` : undefined} aria-invalid={error ? 'true' : undefined} />
      {children}
      {error ? <span role="alert" id={`${id}-error`} className="field-error">{error}</span> : null}
    </div>
  );
}

export function SelectField({ label, value, onValue, options, disabled }: { label: string; value: string; onValue: (value: string) => void; options: { value: string; label: string }[]; disabled?: boolean }) {
  const id = useRef(nextId()).current;
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>{label}</label>
      <select id={id} value={value} disabled={disabled} onChange={(event) => onValue((event.target as HTMLSelectElement).value)}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </div>
  );
}

/** One async action: busy flag, pending and success text in the action status, field errors returned. */
export function useAction(): { busy: boolean; run: (pending: string, success: string | ((result: any) => string), work: () => Promise<unknown>) => Promise<{ ok: boolean; fields: Record<string, string>; result?: unknown }> } {
  const [busy, setBusy] = useState(false);
  return {
    busy,
    async run(pending, success, work) {
      setBusy(true);
      actionStatus.set(pending);
      try {
        const result = await work();
        actionStatus.set(typeof success === 'function' ? success(result) : success);
        return { ok: true, fields: {}, result };
      } catch (error) {
        actionStatus.set('');
        if (error instanceof ApiError && error.status === 401) navigate('/login', true);
        else if (error instanceof ApiError && error.body.errors) return { ok: false, fields: error.fields };
        else refuse(error);
        return { ok: false, fields: {} };
      } finally {
        setBusy(false);
      }
    },
  };
}
