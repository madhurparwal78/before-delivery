// Form pieces: fields with inline errors, the Problems summary, radio groups and the action note. The browser's own
// required and length blocking is never used: the server's 422 decides.
import type { ComponentChildren, JSX, Ref, RefObject } from "preact";
import { useId, useRef, useState } from "preact/hooks";
import { feedback, say, useStore } from "../store";
import { sessionRefusal, type Result } from "../api";
import { Icon } from "./Icon";

type Errors = Record<string, string>;

export interface FormState<F extends Record<string, string>> {
  id: string;
  values: F;
  set: (name: keyof F, value: string) => void;
  errors: Errors;
  setErrors: (errors: Errors) => void;
  refusal: string | null;
  setRefusal: (text: string | null) => void;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  fieldId: (name: string) => string;
  problems: RefObject<HTMLElement>;
  refusalRef: RefObject<HTMLParagraphElement>;
}

export function useForm<F extends Record<string, string>>(initial: F | (() => F)): FormState<F> {
  const id = useId();
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const problems = useRef<HTMLElement>(null);
  const refusalRef = useRef<HTMLParagraphElement>(null);
  return {
    id, values, errors, setErrors, refusal, setRefusal, busy, setBusy, problems, refusalRef,
    set: (name, value) => setValues((v) => ({ ...v, [name]: value })),
    fieldId: (name) => `${id}-${name}`,
  };
}

/** After a refusal, focus goes to the Problems summary or to the form's error text (once they are on screen). */
function focusRefusal(form: FormState<Record<string, string>>, fieldErrors: boolean): void {
  queueMicrotask(() => {
    const target = fieldErrors ? form.problems.current : form.refusalRef.current;
    target?.focus();
  });
}

interface Submission<T> {
  action: string;
  pending: string;
  call: () => Promise<Result<T>>;
  /** API field names that differ from the form's own. */
  fields?: Record<string, string>;
  done: (data: T) => void;
}

/** Runs a form's async action: pending copy, then success, field errors with Problems, or the refusal copy. */
export async function submit<T>(form: FormState<Record<string, string>>, s: Submission<T>): Promise<void> {
  say(s.action, s.pending, "pending");
  form.setBusy(true);
  form.setErrors({});
  form.setRefusal(null);
  const result = await s.call();
  form.setBusy(false);
  if (result.ok) {
    s.done(result.data);
    return;
  }
  const fieldErrors = Object.entries(result.error.fields).map(([k, v]) => [s.fields?.[k] ?? k, v]);
  if (result.status === 422 && fieldErrors.length) {
    form.setErrors(Object.fromEntries(fieldErrors));
    say(s.action, result.error.message, "refusal");
    focusRefusal(form, true);
    return;
  }
  form.setRefusal(result.error.message);
  if (!sessionRefusal(result.error)) say(s.action, result.error.message, "refusal");
  focusRefusal(form, false);
}

interface FieldProps {
  form: FormState<Record<string, string>>;
  name: string;
  label: string;
  /** Guidance shown while the field is valid; its error replaces it. */
  hint?: ComponentChildren;
  /** A live count shown under the field in every state. */
  counter?: string;
  mono?: boolean;
  type?: string;
  multiline?: boolean;
  rows?: number;
  autoComplete?: string;
  inputMode?: JSX.HTMLAttributes<HTMLInputElement>["inputMode"];
  placeholder?: string;
}

export function Field({ form, name, label, hint, counter, mono, type = "text", multiline, rows = 3, autoComplete = "off", inputMode, placeholder }: FieldProps) {
  const id = form.fieldId(name);
  const error = form.errors[name];
  const note = error ? counter : counter ?? hint;
  const describedBy = [error ? `${id}-error` : "", note ? `${id}-hint` : ""].filter(Boolean).join(" ") || undefined;
  const common = {
    id, name, value: form.values[name] ?? "", "aria-invalid": error ? true : undefined, "aria-describedby": describedBy,
    class: `input${mono ? " mono" : ""}${error ? " input-invalid" : ""}`,
  };
  return (
    <div class="field">
      <label class="field-label" for={id}>{label}</label>
      {multiline ? (
        <textarea {...common} rows={rows} onInput={(e) => form.set(name, e.currentTarget.value)} />
      ) : (
        <input {...common} type={type} autoComplete={autoComplete} inputMode={inputMode} placeholder={placeholder}
          onInput={(e) => form.set(name, e.currentTarget.value)} />
      )}
      {note && <p id={`${id}-hint`} class="field-hint">{note}</p>}
      {error && <FieldError id={`${id}-error`} text={error} />}
    </div>
  );
}

export function FieldError({ id, text }: { id: string; text: string }) {
  return (
    <p id={id} class="field-error">
      <Icon name="alert" size={16} />
      <span>{text}</span>
    </p>
  );
}

interface SelectProps {
  form: FormState<Record<string, string>>;
  name: string;
  label: string;
  options: { value: string; label: string }[];
  placeholder?: string;
}

export function SelectField({ form, name, label, options, placeholder }: SelectProps) {
  const id = form.fieldId(name);
  const error = form.errors[name];
  return (
    <div class="field">
      <label class="field-label" for={id}>{label}</label>
      <div class="select-wrap">
        <select id={id} name={name} class={`input select${error ? " input-invalid" : ""}`} value={form.values[name] ?? ""}
          aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined}
          onChange={(e) => form.set(name, e.currentTarget.value)}>
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <Icon name="chevron" size={18} />
      </div>
      {error && <FieldError id={`${id}-error`} text={error} />}
    </div>
  );
}

interface ChoiceProps {
  name: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  error?: string;
  idBase?: string;
  layout?: "row" | "column";
}

export function ChoiceGroup({ name, label, value, options, onChange, error, idBase, layout = "row" }: ChoiceProps) {
  const own = useId();
  const base = idBase ?? own;
  return (
    <div class="field">
      <div role="radiogroup" aria-labelledby={`${base}-label`} aria-describedby={error ? `${base}-error` : undefined}
        class={`choice-group choice-${layout}`}>
        <span id={`${base}-label`} class="field-label">{label}</span>
        <div class="choices">
          {options.map((o, i) => (
            <label key={o.value} class="choice">
              <input type="radio" id={i === 0 ? base : undefined} name={name} value={o.value} checked={value === o.value}
                onChange={() => onChange(o.value)} />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      </div>
      {error && <FieldError id={`${base}-error`} text={error} />}
    </div>
  );
}

/** Every field error as a link that moves focus to its field. */
export function Problems({ form, order }: { form: FormState<Record<string, string>>; order?: string[] }) {
  const names = Object.keys(form.errors).sort((a, b) => (order ? order.indexOf(a) - order.indexOf(b) : 0));
  if (names.length === 0) return null;
  const headingId = `${form.id}-problems`;
  return (
    <section ref={form.problems as Ref<HTMLElement>} class="problems" aria-labelledby={headingId} tabIndex={-1}>
      <h3 id={headingId} class="problems-title">
        <Icon name="alert" size={18} />
        Problems
      </h3>
      <ul class="problems-list">
        {names.map((name) => (
          <li key={name}>
            <a href={`#${form.fieldId(name)}`} onClick={(e) => {
              e.preventDefault();
              document.getElementById(form.fieldId(name))?.focus();
            }}>{form.errors[name]}</a>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The form's own refusal text (a 409 copy, an outage), focusable so the refusal is read at once. */
export function Refusal({ form }: { form: FormState<Record<string, string>> }) {
  return form.refusal ? (
    <p ref={form.refusalRef as Ref<HTMLParagraphElement>} class="refusal" tabIndex={-1}>
      <Icon name="alert" size={18} />
      <span>{form.refusal}</span>
    </p>
  ) : null;
}

/** The copy of the user's last action, shown next to the control that started it. */
export function ActionNote({ action }: { action: string | string[] }) {
  const current = useStore(feedback);
  const actions = Array.isArray(action) ? action : [action];
  if (!current || !actions.includes(current.action)) return null;
  return (
    <p class={`note note-${current.tone}`}>
      <Icon name={current.tone === "success" ? "check" : current.tone === "refusal" ? "alert" : "info"} size={18} />
      <span>{current.text}</span>
    </p>
  );
}

export function Button(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "quiet" | "danger" }) {
  const { variant = "quiet", class: extra, type = "button", ...rest } = props;
  return <button {...rest} type={type} class={`button button-${variant}${extra ? ` ${extra}` : ""}`} />;
}
