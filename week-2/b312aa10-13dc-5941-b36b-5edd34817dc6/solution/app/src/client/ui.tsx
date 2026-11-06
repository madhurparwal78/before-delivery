// Shared controls: labelled fields with linked errors, busy buttons, empty states, icons and the
// brief's error copy.

import type { ComponentChildren, JSX } from "preact";
import { useRef, useState } from "preact/hooks";
import { ApiFailure, NETWORK } from "./api.js";
import { COPY, NETWORK_COPY, variantCopy } from "../shared/copy.js";
import { alertText, announce, clearError, showError } from "./store.js";
import { STATUS_WORDS } from "../shared/format.js";
import type { Status } from "../shared/rules.js";

/**
 * The published copy for an error (Feedback states › Errors); the alert never shows a server's raw
 * text. Codes with one fixed copy read it from the shared table; the rest are filled in here or
 * carry the published copy in the server's message, which follows the same table.
 */
export function errorCopy(error: unknown): string {
  if (!(error instanceof ApiFailure)) return COPY.internal!;
  if (error.code === NETWORK) return NETWORK_COPY;
  if (COPY[error.code]) return COPY[error.code]!;
  switch (error.code) {
    case "invalid_transition": {
      // The status word of the `current` booking in the body (its status after the winning action).
      const current = error.body.current as { status?: string } | undefined;
      const status = (current?.status && current.status in STATUS_WORDS ? current.status : error.body.from) as Status;
      return variantCopy("invalid_transition_booking", STATUS_WORDS[status] ?? String(status));
    }
    case "stale_version":
      return variantCopy("stale_version_move");
    case "rate_limited": {
      if (error.retryAfter === null) return error.message;
      return variantCopy("rate_limited", Math.ceil(error.retryAfter / 60));
    }
    case "block_taken": case "hold_expired": case "document_superseded": case "month_closed":
    case "billing_mismatch": case "rate_version_exists": case "storage_unavailable":
      return error.message;
    default:
      return COPY.internal!;
  }
}

/** On a 422 where Interactions says so: the message of the first field error. */
export function fieldErrorCopy(error: unknown): string {
  if (error instanceof ApiFailure && error.code === "validation_failed") return Object.values(error.fieldErrors)[0] ?? COPY.validation_failed!;
  return errorCopy(error);
}

/**
 * Latest view wins: `begin()` starts a request for the view now shown and returns a check that is
 * true only while no later request has begun, so a late answer for an earlier view is never drawn.
 */
export function useLatest(): () => () => boolean {
  const seq = useRef(0);
  return () => {
    const mine = ++seq.current;
    return () => seq.current === mine;
  };
}

/**
 * Runs an async action with its pending state: the button is disabled and marked busy within the
 * same frame, the pending copy is announced, and errors go to the alert unless `onError` takes them.
 */
export function useAction(): {
  busy: string | null;
  run: (name: string, pending: string, work: () => Promise<string | null>, onError?: (e: unknown) => boolean) => Promise<boolean>;
} {
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (name: string, pending: string, work: () => Promise<string | null>, onError?: (e: unknown) => boolean): Promise<boolean> => {
    setBusy(name);
    clearError();
    announce(pending);
    try {
      const done = await work();
      if (done) announce(done);
      return true;
    } catch (error) {
      if (!onError?.(error)) showError(errorCopy(error));
      // A 422 whose fields the form shows: the alert carries the validation copy unless the handler
      // already wrote the copy Interactions names.
      else if (error instanceof ApiFailure && error.code === "validation_failed" && !alertText.get().text) showError(COPY.validation_failed!);
      announce("");
      return false;
    } finally {
      setBusy(null);
    }
  };
  return { busy, run };
}

type ButtonProps = JSX.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean; variant?: "primary" | "quiet" | "danger" };

export function Button({ busy, variant, class: cls, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      type={rest.type ?? "button"}
      class={["btn", variant ? `btn-${variant}` : "", cls ?? ""].join(" ").trim()}
      disabled={busy || Boolean(disabled)}
      aria-busy={busy ? "true" : undefined}
    >
      {children}
    </button>
  );
}

let fieldIds = 0;
export const useId = (prefix: string): string => useState(() => `${prefix}-${++fieldIds}`)[0];

interface FieldProps {
  label: string;
  error?: string | undefined;
  children: (props: { id: string; "aria-invalid"?: "true"; "aria-describedby"?: string }) => ComponentChildren;
  hint?: string;
}

/** A label above its control, with any field error under it, linked as its description. */
export function Field({ label, error, children, hint }: FieldProps) {
  const id = useId("field");
  const described = [hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ");
  return (
    <div class={error ? "field field-invalid" : "field"}>
      <label for={id}>{label}</label>
      {children({ id, ...(error ? { "aria-invalid": "true" as const } : {}), ...(described ? { "aria-describedby": described } : {}) })}
      {hint && <p class="field-hint" id={`${id}-hint`}>{hint}</p>}
      {error && <p class="field-error" id={`${id}-error`}>{error}</p>}
    </div>
  );
}

/** Focuses the first control marked invalid inside `root`, after the render that marks it. */
export function focusFirstInvalid(root: HTMLElement | null, fallback?: HTMLElement | null): void {
  queueMicrotask(() => {
    const target = root?.querySelector<HTMLElement>("[aria-invalid=true]") ?? fallback ?? null;
    target?.focus();
  });
}

/** The empty ticket spike: nothing on the spike yet. */
function EmptySpike() {
  return (
    <svg class="spike" viewBox="0 0 48 48" width="48" height="48" aria-hidden="true" focusable="false">
      <path d="M8 42h32" class="spike-ink" />
      <path d="M24 42V8" class="spike-ink" />
      <path d="M24 8l-2 4h4z" class="spike-ink" />
      <path d="M14 22h20v10H14z" class="spike-rule" />
      <path d="M14 22l3 2 3-2 4 2 4-2 3 2 3-2" class="spike-rule" />
      <path d="M17 27h10" class="spike-rule" />
    </svg>
  );
}

/** A table's loading or empty note as its one full-width row, so the table keeps its place and size. */
export function NoteRow({ columns, children }: { columns: number; children: ComponentChildren }) {
  return <tr><td class="note-cell" colSpan={columns}>{children}</td></tr>;
}

export function Empty({ children }: { children: ComponentChildren }) {
  return (
    <div class="empty">
      <EmptySpike />
      <p>{children}</p>
    </div>
  );
}

// Lucide icons (ISC): chevron-left, chevron-right, menu, x.
const ICONS: Record<string, string[]> = {
  "chevron-left": ["m15 18-6-6 6-6"],
  "chevron-right": ["m9 18 6-6-6-6"],
  menu: ["M4 12h16", "M4 6h16", "M4 18h16"],
  x: ["M18 6 6 18", "m6 6 12 12"],
};

export function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg class="icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      {ICONS[name]!.map((d) => <path d={d} />)}
    </svg>
  );
}

/** A month field committed on Enter or when it loses focus. */
export function MonthField({ label, value, error, onCommit }: { label: string; value: string; error?: string | undefined; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value);
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    setText(value);
  }
  return (
    <Field label={label} error={error} hint="YYYY-MM">
      {(p) => (
        <input
          {...p}
          type="text"
          class="input input-month"
          inputMode="numeric"
          autoComplete="off"
          value={text}
          onInput={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onCommit(e.currentTarget.value.trim());
          }}
          onBlur={(e) => onCommit(e.currentTarget.value.trim())}
        />
      )}
    </Field>
  );
}
