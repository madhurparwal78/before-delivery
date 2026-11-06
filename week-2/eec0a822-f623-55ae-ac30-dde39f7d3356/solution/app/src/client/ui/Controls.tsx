import type { ComponentChildren, JSX, Ref } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { COPY } from "../../shared/copy";
import { announce } from "../lib/announce";
import { followLink, saveDrafts } from "../lib/nav";

export interface Note {
  text: string;
  tone: "ok" | "error";
}

export const ok = (text: string): Note => ({ text, tone: "ok" });
export const bad = (text: string): Note => ({ text, tone: "error" });

interface Action {
  pending: boolean;
  note: Note | null;
  setNote: (note: Note | null) => void;
  /** Runs one async action: the button shows its pending label, then the result note shows and is announced. */
  run: (pendingLabel: string, work: () => Promise<Note | null>) => Promise<void>;
  /** Runs `move` once the action has finished and its controls are enabled again (focus after a refusal). */
  focusLater: (move: () => void) => void;
}

export function useAction(): Action {
  const [pending, setPending] = useState(false);
  const [note, setNoteState] = useState<Note | null>(null);
  const busy = useRef(false);
  const later = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    if (pending || !later.current) return;
    const move = later.current;
    later.current = null;
    move();
  });
  const setNote = (next: Note | null) => {
    setNoteState(next);
    if (next) announce(next.text);
  };
  const run = async (pendingLabel: string, work: () => Promise<Note | null>) => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setNoteState(null);
    if (pendingLabel) announce(pendingLabel);
    try {
      const result = await work();
      if (result) setNote(result);
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  return { pending, note, setNote, run, focusLater: (move) => (later.current = move) };
}

/** The sign-in address that brings the member back here afterwards. */
function signInAgainHref(): string {
  return `/sign-in?return=${encodeURIComponent(location.pathname + location.search)}`;
}

/** An action's message, shown next to the action. The session-ended copy carries its Sign in again link. */
export function NoteLine({ note, class: extra }: { note: Note | null; class?: string }) {
  if (!note) return null;
  const sessionEnded = note.text === COPY.sessionEnded;
  return (
    <p class={`note note--${note.tone}${extra ? ` ${extra}` : ""}`}>
      <span>{note.text}</span>
      {sessionEnded ? (
        <>
          {" "}
          <a
            class="note__link"
            href={signInAgainHref()}
            onClick={(event) => {
              saveDrafts();
              followLink(event, signInAgainHref());
            }}
          >
            Sign in again
          </a>
        </>
      ) : null}
    </p>
  );
}

type ButtonProps = JSX.HTMLAttributes<HTMLButtonElement> & {
  pending?: boolean;
  pendingLabel?: string;
  variant?: "primary" | "quiet" | "danger";
  disabled?: boolean;
  type?: "button" | "submit";
  buttonRef?: Ref<HTMLButtonElement>;
};

export function Button({ pending, pendingLabel, variant = "primary", children, disabled, type = "button", buttonRef, ...rest }: ButtonProps) {
  return (
    <button {...rest} ref={buttonRef} type={type} class={`btn btn--${variant}${rest.class ? ` ${rest.class}` : ""}`} disabled={disabled || pending}>
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}

export function Link({ href, children, ...rest }: JSX.HTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return (
    <a {...rest} href={href} onClick={(event) => followLink(event, href)}>
      {children}
    </a>
  );
}

interface FieldProps {
  id: string;
  label: string;
  value: string;
  onInput: (value: string) => void;
  error?: string;
  type?: "text" | "email" | "password" | "number" | "search";
  inputMode?: "decimal" | "numeric" | "email" | "text";
  autoComplete?: string;
  hint?: ComponentChildren;
  first?: boolean;
  onKeyDown?: (event: KeyboardEvent) => void;
}

/** A labelled text field with its inline error. Browser required/length blocking is never used. */
export function Field({ id, label, value, onInput, error, type = "text", inputMode, autoComplete, hint, first, onKeyDown }: FieldProps) {
  return (
    <div class={`field${error ? " field--error" : ""}`}>
      <label for={id}>{label}</label>
      <input
        id={id}
        type={type}
        value={value}
        inputMode={inputMode}
        autoComplete={autoComplete ?? "off"}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        data-first={first ? "" : undefined}
        onInput={(event) => onInput((event.currentTarget as HTMLInputElement).value)}
        onKeyDown={onKeyDown}
      />
      {hint ? <p class="field__hint">{hint}</p> : null}
      {error ? (
        <p class="field__error" id={`${id}-error`}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

interface SelectProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
  error?: string;
  first?: boolean;
}

export function SelectField({ id, label, value, onChange, options, error, first }: SelectProps) {
  return (
    <div class={`field${error ? " field--error" : ""}`}>
      <label for={id}>{label}</label>
      <select
        id={id}
        value={value}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        data-first={first ? "" : undefined}
        onChange={(event) => onChange((event.currentTarget as HTMLSelectElement).value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error ? (
        <p class="field__error" id={`${id}-error`}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** The Problems summary at the top of a form outside a dialog: one link per field error. */
export function Problems({ errors, labels }: { errors: Record<string, string>; labels: Record<string, { label: string; id: string }> }) {
  const entries = Object.entries(errors).filter(([field]) => labels[field]);
  if (!entries.length) return null;
  return (
    <section class="problems" role="region" aria-labelledby="problems-heading" tabIndex={-1}>
      <h2 id="problems-heading">Problems</h2>
      <ul>
        {entries.map(([field, message]) => (
          <li key={field}>
            <a
              href={`#${labels[field].id}`}
              onClick={(event) => {
                event.preventDefault();
                document.getElementById(labels[field].id)?.focus();
              }}
            >
              {labels[field].label}: {message}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Moves focus to the first field in error, or to the action button when the error is not about a field. */
export function focusFirstError(ids: string[], fallback?: HTMLElement | null): void {
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) {
      el.focus();
      return;
    }
  }
  fallback?.focus();
}
