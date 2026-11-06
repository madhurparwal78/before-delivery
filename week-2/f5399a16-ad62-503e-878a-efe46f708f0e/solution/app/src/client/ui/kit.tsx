// The small parts every screen is built from.

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createContext, useContext } from 'react';
import { COPY } from '../../shared/copy';
import { announce } from '../announce';
import { ApiError } from '../api';
import { navigate, useRoute, type EntryMemory, type Route } from '../router';
import { clearResume, readResume, setActiveForm, keepDraftForSignIn, useSessionEnded } from '../session';

/** The page language's forms of a few shared words, for private pages. */
export const WordsContext = createContext<{ working: string; problems: string; refreshLine: string }>({ working: COPY.working, problems: 'Problems', refreshLine: COPY.refreshFailed });

export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (listener) => {
      const list = matchMedia(query);
      list.addEventListener('change', listener);
      return () => list.removeEventListener('change', listener);
    },
    () => matchMedia(query).matches,
  );
}

export const WIDE = '(min-width: 1100px)';
export const NARROW = '(max-width: 767px)';

export function Link({ href, memory, onClick, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; memory?: EntryMemory }) {
  return (
    <a
      href={href}
      {...rest}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        event.preventDefault();
        navigate(href, memory ? { memory } : {});
      }}
    >
      {children}
    </a>
  );
}

// Heading and the signed-in focus rule ------------------------------------------------------------

let headingFocusWanted = false;

/** The next heading to mount or change takes focus: a route change landed. */
export function wantHeadingFocus(): void {
  headingFocusWanted = true;
}

export function focusHeading(): void {
  const heading = document.querySelector<HTMLElement>('#app h1');
  heading?.focus({ preventScroll: true });
}

export function Heading({ title, refreshFailed, documentTitle }: { title: string; refreshFailed?: boolean; documentTitle?: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  const words = useContext(WordsContext);
  const route = useRoute();
  const landed = useRef(false);
  useTitle(documentTitle ?? title);
  useLayoutEffect(() => {
    if (!landed.current) {
      landed.current = true;
      landScroll(route);
    }
    if (headingFocusWanted) {
      headingFocusWanted = false;
      ref.current?.focus({ preventScroll: true });
    }
  });
  return (
    <>
      <h1 ref={ref} tabIndex={-1}>{title}</h1>
      {refreshFailed ? <p className="refresh-line">{words.refreshLine}</p> : null}
    </>
  );
}

/** SR22: where a screen lands: the top, or on Back and reload where it was. */
export function landScroll(route: Route): void {
  if (route.by === 'push') window.scrollTo(0, 0);
  else if (route.memory.y !== undefined) window.scrollTo(0, route.memory.y);
}

export function useTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} — Clapstick`;
  }, [title]);
}

export function SignInAgain() {
  const here = location.pathname + location.search;
  return (
    <p className="session-line">
      <Link href={`/sign-in?next=${encodeURIComponent(here)}`} onClick={keepDraftForSignIn}>Sign in again</Link>
    </p>
  );
}

/** On a page with no dialog open; a dialog shows its own. */
export function SessionLine() {
  const ended = useSessionEnded();
  const open = useOpenOverlays();
  return ended && open === 0 ? <SignInAgain /> : null;
}

// Modal count: the page behind is inert while one is open ----------------------------------------

let openOverlays = 0;
const overlayListeners = new Set<() => void>();

export function countOverlay(change: 1 | -1): void {
  openOverlays += change;
  document.getElementById('app')?.toggleAttribute('inert', openOverlays > 0);
  for (const listener of overlayListeners) listener();
}

function useOpenOverlays(): number {
  return useSyncExternalStore(
    (listener) => {
      overlayListeners.add(listener);
      return () => overlayListeners.delete(listener);
    },
    () => openOverlays,
  );
}

// Buttons ------------------------------------------------------------------------------------------

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { kind?: 'primary' | 'ink' | 'plain' };

export function classOf(kind: ButtonProps['kind']): string {
  return kind === 'plain' ? 'btn btn-plain' : kind === 'ink' ? 'btn btn-ink' : 'btn';
}

/** SR11: reads Working… while its request is open; a further press sends nothing. */
export function AsyncButton({ label, onPress, kind, className, disabledReason, ...rest }: Omit<ButtonProps, 'onClick'> & { label: string; onPress: () => Promise<unknown>; disabledReason?: boolean }) {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const words = useContext(WordsContext);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return (
    <button
      type="button"
      className={`${classOf(kind)} ${className ?? ''}`}
      aria-disabled={busy || disabledReason ? true : undefined}
      {...rest}
      onClick={() => {
        if (busyRef.current || disabledReason) return;
        busyRef.current = true;
        setBusy(true);
        void onPress().finally(() => {
          busyRef.current = false;
          if (mounted.current) setBusy(false);
        });
      }}
    >
      {busy ? words.working : label}
    </button>
  );
}

// Forms --------------------------------------------------------------------------------------------

interface Form<T> {
  values: T;
  set(key: keyof T & string, value: unknown): void;
  setAll(values: T): void;
  fields: Record<string, string>;
  message: string | null;
  busy: boolean;
  submit(work: () => Promise<void>): Promise<void>;
  refuse(message: string, fields?: Record<string, string>): void;
  clear(): void;
  fieldId(name: string): string;
  problemsRef: React.RefObject<HTMLDivElement | null>;
  focusMessage: boolean;
}

export function useForm<T extends object>(key: string | null, initial: () => T, options: { focusMessage?: boolean } = {}): Form<T> {
  const [values, setValues] = useState<T>(() => {
    const resume = key ? readResume(key) : null;
    return resume ? { ...initial(), ...(resume.values as T) } : initial();
  });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const latest = useRef(values);
  latest.current = values;
  const base = useId();
  const problemsRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef(false);
  const focusMessage = options.focusMessage ?? false;
  const fieldId = useCallback((name: string) => `${base}-${name}`, [base]);

  useEffect(() => {
    if (!key) return;
    if (readResume(key)) clearResume();
    setActiveForm({ key, values: () => latest.current });
    return () => setActiveForm(null);
  }, [key]);

  useLayoutEffect(() => {
    if (pendingFocus.current) {
      pendingFocus.current = false;
      problemsRef.current?.focus();
    }
  });

  const refuse = useCallback((text: string, refusedFields: Record<string, string> = {}) => {
    setFields(refusedFields);
    setMessage(text);
    announce(text);
    if (focusMessage) pendingFocus.current = true;
  }, [focusMessage]);

  return {
    values,
    set: (name, value) => setValues((held) => ({ ...held, [name]: value })),
    setAll: setValues,
    fields,
    message,
    busy,
    refuse,
    clear: () => {
      setFields({});
      setMessage(null);
    },
    submit: async (work) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setFields({});
      setMessage(null);
      try {
        await work();
      } catch (error) {
        if (error instanceof ApiError) {
          if (error.status !== 401 || error.code === 'wrongSignIn') refuse(error.message, error.fields);
        } else {
          throw error;
        }
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    fieldId,
    problemsRef,
    focusMessage,
  };
}

function ErrorMark() {
  return <span className="err-bar" aria-hidden="true" />;
}

export function Problems({ form, labels }: { form: Pick<Form<never>, 'fields' | 'message' | 'fieldId' | 'problemsRef'>; labels?: Record<string, string> }) {
  const words = useContext(WordsContext);
  const headingId = useId();
  if (!form.message && !Object.keys(form.fields).length) return null;
  const entries = Object.entries(form.fields);
  return (
    <div ref={form.problemsRef} className="problems" role="region" aria-labelledby={headingId} tabIndex={-1}>
      <h2 id={headingId} className="problems-title"><ErrorMark />{words.problems}</h2>
      {entries.length ? (
        <ul>
          {entries.map(([name, text]) => (
            <li key={name}>
              <a
                href={`#${form.fieldId(name)}`}
                onClick={(event) => {
                  event.preventDefault();
                  document.getElementById(form.fieldId(name))?.focus();
                }}
              >
                {labels?.[name] ? `${labels[name]}: ` : ''}{text}
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p>{form.message}</p>
      )}
    </div>
  );
}

interface FieldBase {
  form: Form<any>;
  name: string;
  label: string;
  /** The server's field name when it differs. */
  errorKey?: string;
}

function useFieldState({ form, name, errorKey }: FieldBase) {
  const key = errorKey ?? name;
  const id = form.fieldId(key);
  const error = form.fields[key];
  return { id, error, describedBy: error ? `${id}-message` : undefined };
}

function FieldMessage({ id, error }: { id: string; error: string | undefined }) {
  return error ? <p id={`${id}-message`} className="field-message"><ErrorMark />{error}</p> : null;
}

export function TextField(props: FieldBase & { autoComplete?: string; type?: string; inputMode?: 'decimal' | 'text' | 'email' | 'tel'; onBlur?: () => void; hint?: string; numeric?: boolean }) {
  const { form, name, label, autoComplete, type, inputMode, onBlur, numeric } = props;
  const { id, error, describedBy } = useFieldState(props);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className={numeric ? 'tabular' : undefined}
        type={type ?? 'text'}
        value={form.values[name] as string}
        autoComplete={autoComplete ?? 'off'}
        inputMode={inputMode}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        onChange={(event) => form.set(name, event.target.value)}
        onBlur={onBlur}
      />
      <FieldMessage id={id} error={error} />
    </div>
  );
}

export function TextArea(props: FieldBase & { onBlur?: () => void }) {
  const { form, name, label, onBlur } = props;
  const { id, error, describedBy } = useFieldState(props);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <textarea
        id={id}
        rows={3}
        value={form.values[name] as string}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        onChange={(event) => form.set(name, event.target.value)}
        onBlur={onBlur}
      />
      <FieldMessage id={id} error={error} />
    </div>
  );
}

export function SelectField(props: FieldBase & { options: readonly (readonly [string, string])[] }) {
  const { form, name, label, options } = props;
  const { id, error, describedBy } = useFieldState(props);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={form.values[name] as string}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        onChange={(event) => form.set(name, event.target.value)}
      >
        {options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
      </select>
      <FieldMessage id={id} error={error} />
    </div>
  );
}

export function Select({ label, value, options, onChange, id: givenId, describedBy }: { label: string; value: string; options: readonly (readonly [string, string])[]; onChange: (value: string) => void; id?: string; describedBy?: string }) {
  const own = useId();
  const id = givenId ?? own;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} aria-describedby={describedBy} onChange={(event) => onChange(event.target.value)}>
        {options.map(([optionValue, text]) => <option key={optionValue} value={optionValue}>{text}</option>)}
      </select>
    </div>
  );
}

export function RadioGroup({ label, name, value, options, onChange }: { label: string; name: string; value: string; options: readonly (readonly [string, string])[]; onChange: (value: string) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="choices">
      {options.map(([optionValue, text]) => (
        <label key={optionValue} className="choice">
          <input type="radio" name={name} className="sr-only" checked={value === optionValue} onChange={() => onChange(optionValue)} />
          <span>{text}</span>
        </label>
      ))}
    </div>
  );
}

// Presentational -----------------------------------------------------------------------------------

export function LoadingBars() {
  return <div className="loading-bars" aria-hidden="true"><span /><span /><span /></div>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-bar" aria-hidden="true" />
      <p>{children}</p>
    </div>
  );
}

export function BottomBar({ children }: { children: ReactNode }) {
  return <div className="bottom-bar">{children}</div>;
}

export function NotFound() {
  return (
    <section className="not-found">
      <Heading title="Page not found" />
      <EmptyState>There is nothing at this address.</EmptyState>
      <p><Link href="/">Noor Bakker Boards</Link></p>
    </section>
  );
}

export function ThumbMask({ src, alt = '', children }: { src: string | null; alt?: string; children?: ReactNode }) {
  return (
    <div className="slant-mask">
      {src ? <img src={src} alt={alt} draggable={false} /> : <div className="slate-empty" />}
      {children}
    </div>
  );
}
