// Shared page parts: field wrapper, the pending line and the status line with the two live regions.
import type { ComponentChildren } from "preact";
import { feedback } from "../feedback";
import { useReducedMotion, useStore } from "../store";

let fieldCount = 0;

export function nextFieldId(prefix: string): string {
  return `${prefix}-${++fieldCount}`;
}

interface FieldProps {
  id: string;
  label: string;
  error?: string | null;
  hint?: string;
  children: ComponentChildren;
}

/** A labelled control with its helper text and its error, both linked as the control's description. */
export function Field({ id, label, error, hint, children }: FieldProps) {
  return (
    <div class={error ? "field field-invalid" : "field"}>
      <label for={id}>{label}</label>
      {children}
      {hint && (
        <p class="field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {error && (
        <p class="field-error" id={`${id}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}

/** The aria-describedby value for a control rendered inside `Field`. */
export function describedBy(id: string, error: string | null | undefined, hint?: boolean): string | undefined {
  const ids = [hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean);
  return ids.length ? ids.join(" ") : undefined;
}

/** A hairline that sweeps while any request is pending; static "Working…" under reduced motion. */
export function PendingLine() {
  const { pending } = useStore(feedback);
  const reduced = useReducedMotion();
  return (
    <div class="pending-line" aria-hidden={reduced ? undefined : "true"}>
      {pending > 0 && (reduced ? <span class="working">Working…</span> : <span class="sweep" />)}
    </div>
  );
}

/** The always-present status line holding the polite Activity and assertive Problem regions. */
export function StatusLine() {
  const { activity, problem } = useStore(feedback);
  return (
    <div class="status-line">
      <p class="status-key" aria-hidden="true" data-key="Activity" />
      <p class="activity" role="status" aria-label="Activity" aria-live="polite">
        {activity}
      </p>
      <p class="status-key" aria-hidden="true" data-key="Problem" />
      <p class="problem" role="alert" aria-label="Problem" aria-live="assertive">
        {problem && (
          <>
            <span class="conflict-mark" aria-hidden="true" />
            <span>{problem.text}</span>
          </>
        )}
      </p>
    </div>
  );
}

/** A spec-sheet section number and label in mono caps. Drawn from CSS so it adds nothing to the page's text. */
export function Eyebrow({ n, label }: { n: number; label: string }) {
  return <p class="eyebrow" aria-hidden="true" data-eyebrow={`${String(n).padStart(2, "0")} — ${label}`} />;
}

export function EmptyRow({ columns, text }: { columns: number; text: string }) {
  return (
    <tr role="row" class="empty-row">
      <td role="cell" colSpan={columns}>
        {text}
      </td>
    </tr>
  );
}
