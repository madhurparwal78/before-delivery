import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react';
import { api, ApiFailure } from './api';
import { refreshMe } from './store';
import { focusablesIn, restoreFocus, useFocusTrap } from './ui';

type Mode = 'signup' | 'signin';

interface Request {
  mode: Mode;
  opener: HTMLElement | null;
  then: () => void;
  note?: string;
}

let request: Request | null = null;
let open = false;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

export function openSheet(next: Omit<Request, 'mode'> & { mode?: Mode }): void {
  request = { mode: 'signup', ...next };
  open = true;
  emit();
}

function closeSheet(): void {
  open = false;
  emit();
}

function useSheetOpen(): boolean {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, () => open);
}

const SENTENCE = {
  email: 'Enter a valid email address.',
  password: 'Use at least 8 characters.',
  displayName: 'Use 2 to 20 characters.',
  birthYear: 'Enter a four-digit year.',
  underAge: 'Headstring is for players 13 and over.',
  minor: 'Age under 18: tables are open, Cash packs are not.',
};

const FIELD_ID: Record<string, string> = { email: 'sheet-email', password: 'sheet-password', displayName: 'sheet-name', birthYear: 'sheet-year' };

function ageFrom(year: string): number | null {
  return /^\d{4}$/.test(year) ? new Date().getUTCFullYear() - Number(year) : null;
}

function localErrors(mode: Mode, email: string, password: string, name: string, year: string): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errors.email = SENTENCE.email;
  if (mode === 'signin') {
    if (password.length === 0) errors.password = SENTENCE.password;
    return errors;
  }
  if (password.length < 8 || password.length > 72) errors.password = SENTENCE.password;
  if (name.trim().length < 2 || name.trim().length > 20) errors.displayName = SENTENCE.displayName;
  if (ageFrom(year) === null) errors.birthYear = SENTENCE.birthYear;
  return errors;
}

export function AuthSheet(): ReactNode {
  const isOpen = useSheetOpen();
  const box = useRef<HTMLDivElement>(null);
  const summary = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [year, setYear] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);

  const close = (): void => {
    closeSheet();
    restoreFocus(request?.opener ?? null);
  };
  useFocusTrap(box, isOpen, close);

  useLayoutEffect(() => {
    if (!isOpen) return;
    setMode(request?.mode ?? 'signup');
    focusablesIn(box.current as HTMLDivElement)[1]?.focus();
  }, [isOpen]);

  useEffect(() => {
    if (Object.keys(errors).length > 0) summary.current?.focus();
  }, [errors]);

  const age = ageFrom(year);
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setMessage('');
    const found = localErrors(mode, email, password, name, year);
    if (Object.keys(found).length === 0 && mode === 'signup' && (age as number) < 13) {
      setErrors({});
      setMessage(SENTENCE.underAge);
      return;
    }
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setPending(true);
    try {
      if (mode === 'signup') {
        await api('POST', '/api/auth/signup', { email: email.trim(), password, displayName: name.trim(), birthYear: Number(year) });
      } else {
        await api('POST', '/api/auth/signin', { email: email.trim(), password });
      }
      await refreshMe();
      const then = request?.then;
      closeSheet();
      setPassword('');
      then?.();
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 422) setErrors(error.errors);
      else setMessage(error instanceof ApiFailure ? error.message : 'Could not reach the table');
    } finally {
      setPending(false);
    }
  };

  const fieldError = (key: string): ReactNode => errors[key] !== undefined && <p className="field-error" id={`${FIELD_ID[key]}-error`}>{errors[key]}</p>;
  const described = (key: string): { 'aria-invalid'?: true; 'aria-describedby'?: string } =>
    errors[key] === undefined ? {} : { 'aria-invalid': true, 'aria-describedby': `${FIELD_ID[key]}-error` };
  const title = mode === 'signup' ? 'Create your account' : 'Sign in';
  const switchMode = (next: Mode): void => {
    setMode(next);
    setErrors({});
    setMessage('');
  };

  return (
    <>
      <div className={`scrim${isOpen ? ' open' : ''}`} onClick={close} />
      <div ref={box} className={`sheet${isOpen ? ' open' : ''}`} role="dialog" aria-modal="true" aria-label={title} aria-hidden={!isOpen} inert={!isOpen}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button type="button" onClick={close}>Close</button>
        </div>
        {request?.note !== undefined && <p className="note">{request.note}</p>}
        {Object.keys(errors).length > 0 && (
          <div ref={summary} className="summary" role="alert" aria-label="Check these fields" tabIndex={-1}>
            <strong>Check these fields</strong>
            {Object.entries(errors).map(([key, sentence]) => (
              <a
                key={key}
                href={`#${FIELD_ID[key]}`}
                onClick={(event) => {
                  event.preventDefault();
                  document.getElementById(FIELD_ID[key])?.focus();
                }}
              >
                {sentence}
              </a>
            ))}
          </div>
        )}
        <form onSubmit={(event) => void submit(event)} noValidate className="sheet-actions">
          <div className="field">
            <label htmlFor="sheet-email">Email</label>
            <input id="sheet-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} {...described('email')} />
            {fieldError('email')}
          </div>
          <div className="field">
            <label htmlFor="sheet-password">Password</label>
            <input id="sheet-password" type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} {...described('password')} />
            {fieldError('password')}
          </div>
          {mode === 'signup' && (
            <>
              <div className="field">
                <label htmlFor="sheet-name">Display name</label>
                <input id="sheet-name" type="text" autoComplete="nickname" value={name} onChange={(event) => setName(event.target.value)} {...described('displayName')} />
                {fieldError('displayName')}
              </div>
              <div className="field">
                <label htmlFor="sheet-year">Year of birth</label>
                <input id="sheet-year" type="text" inputMode="numeric" autoComplete="bday-year" value={year} onChange={(event) => setYear(event.target.value)} {...described('birthYear')} />
                {fieldError('birthYear')}
                {age !== null && age >= 13 && age < 18 && <p className="note">{SENTENCE.minor}</p>}
              </div>
            </>
          )}
          {message !== '' && <p className="field-error" role="status">{message}</p>}
          {mode === 'signup'
            ? <button type="submit" className="primary" disabled={pending}>{pending ? 'Creating your account' : 'Create account'}</button>
            : <button type="submit" className="primary" disabled={pending}>Sign in</button>}
          {mode === 'signup'
            ? <button type="button" onClick={() => switchMode('signin')}>Sign in instead</button>
            : <button type="button" onClick={() => switchMode('signup')}>Create an account instead</button>}
        </form>
      </div>
    </>
  );
}
