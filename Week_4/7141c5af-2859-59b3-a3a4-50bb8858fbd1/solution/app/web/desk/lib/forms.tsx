import type { ButtonHTMLAttributes, ComponentChildren, JSX } from "preact";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import { copy } from "../../../server/domain/copy.ts";
import { glyph } from "../../shared/dots.ts";
import { announce } from "./announce.ts";
import { ApiFailure } from "./api.ts";
import type { DialogControl } from "./dialog.tsx";
import { trackForm } from "./drafts.ts";

type Errors = Record<string, string>;

export interface Form<Values extends Record<string, string>> {
  values: Values;
  set: (name: keyof Values & string, value: string) => void;
  replace: (values: Values) => void;
  errors: Errors;
  /** A refusal that belongs to no field, shown in the summary and linked to the first field. */
  general: string | null;
  /** Runs a write. Refusals land in the summary, in Announcements, and return false. */
  submit: (write: () => Promise<void>) => Promise<boolean>;
  refuse: (errors: Errors) => void;
  clear: () => void;
  ids: Record<string, string>;
  turn: number;
}

/** Form state. Given a dialog, what is typed survives an ended session (a draft) and comes back on return. */
export function useForm<Values extends Record<string, string>>(initial: Values, dialog?: DialogControl, failedSend: string = copy("F-02")): Form<Values> {
  const [values, setValues] = useState<Values>({ ...initial, ...(dialog?.draft?.values as Partial<Values> | undefined) });
  const [errors, setErrors] = useState<Errors>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [turn, setTurn] = useState(0);
  const prefix = useId();
  const latest = useRef(values);
  latest.current = values;

  useEffect(() => {
    if (!dialog?.open) return undefined;
    return trackForm(dialog.name, () => latest.current);
  }, [dialog?.open]);

  const ids = new Proxy({} as Record<string, string>, { get: (_, name: string) => `${prefix}-${name}` });

  const refuse = (next: Errors): void => {
    setGeneral(null);
    setErrors(next);
    setTurn((value) => value + 1);
    const first = Object.values(next)[0];
    if (first) announce(first);
  };

  return {
    values,
    set: (name, value) => setValues((old) => ({ ...old, [name]: value })),
    replace: setValues,
    errors,
    general,
    ids,
    turn,
    refuse,
    clear: () => {
      setErrors({});
      setGeneral(null);
    },
    submit: async (write) => {
      try {
        await write();
        setErrors({});
        setGeneral(null);
        return true;
      } catch (error) {
        if (!(error instanceof ApiFailure)) {
          setGeneral(failedSend);
          setTurn((value) => value + 1);
          announce(failedSend);
          return false;
        }
        const fields = Object.keys(error.fields).length > 0 ? error.fields : null;
        setErrors(fields ?? {});
        setGeneral(fields ? null : error.message);
        setTurn((value) => value + 1);
        announce(error.status === 401 ? copy("F-03") : (Object.values(error.fields)[0] ?? error.message));
        return false;
      }
    },
  };
}

interface FieldProps<Values extends Record<string, string>> {
  form: Form<Values>;
  name: keyof Values & string;
  label: string;
  multiline?: boolean;
  type?: "text" | "password";
  autocomplete?: "name" | "email" | "tel" | "current-password" | "new-password" | "off";
  inputMode?: "text" | "decimal" | "numeric";
}

function fieldBits<Values extends Record<string, string>>(form: Form<Values>, name: string) {
  const id = form.ids[name] as string;
  const error = form.errors[name];
  return { id, error, messageId: `${id}-message`, aria: error ? { "aria-invalid": "true" as const, "aria-describedby": `${id}-message` } : {} };
}

function FieldMessage({ id, text }: { id: string; text: string | undefined }): JSX.Element | null {
  if (!text) return null;
  return (
    <span class="field-message" id={id}>
      <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: glyph("refused") }} />
      {text}
    </span>
  );
}

/** A labelled text field with its message as its accessible description. */
export function Field<Values extends Record<string, string>>({ form, name, label, multiline, type = "text", autocomplete, inputMode }: FieldProps<Values>): JSX.Element {
  const { id, error, messageId, aria } = fieldBits(form, name);
  const shared = { id, class: "input", value: form.values[name], ...aria };
  return (
    <div class="field">
      <label for={id}>{label}</label>
      {multiline ? (
        <textarea {...shared} onInput={(event) => form.set(name, event.currentTarget.value)} />
      ) : (
        <input type={type as "text"} autocomplete={autocomplete} inputMode={inputMode} {...shared} onInput={(event) => form.set(name, event.currentTarget.value)} />
      )}
      <FieldMessage id={messageId} text={error} />
    </div>
  );
}

export interface Choice {
  value: string;
  label: string;
}

interface SelectProps<Values extends Record<string, string>> {
  form: Form<Values>;
  name: keyof Values & string;
  label: string;
  choices: readonly Choice[];
  onChoose?: (value: string) => void;
}

export function SelectField<Values extends Record<string, string>>({ form, name, label, choices, onChoose }: SelectProps<Values>): JSX.Element {
  const { id, error, messageId, aria } = fieldBits(form, name);
  return (
    <div class="field">
      <label for={id}>{label}</label>
      <select
        id={id}
        class="input"
        {...aria}
        value={form.values[name]}
        onChange={(event) => {
          form.set(name, event.currentTarget.value);
          onChoose?.(event.currentTarget.value);
        }}
      >
        {choices.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
      <FieldMessage id={messageId} text={error} />
    </div>
  );
}

interface ProblemsProps<Values extends Record<string, string>> {
  form: Form<Values>;
  /** The field a refusal with no field of its own links to. */
  firstField: keyof Values & string;
  /** Inside a dialog focus goes to the summary as it appears. */
  takeFocus?: boolean;
  /** The region's name and heading: `Problems`, or C26 on the client page. */
  heading?: string;
}

/** The form error summary: one link per refused field, whose text is that field's message. */
export function Problems<Values extends Record<string, string>>({ form, firstField, takeFocus = true, heading = "Problems" }: ProblemsProps<Values>): JSX.Element | null {
  const region = useRef<HTMLDivElement>(null);
  const entries: [string, string][] = Object.entries(form.errors);
  if (form.general) entries.push([firstField, form.general]);
  useLayoutEffect(() => {
    if (takeFocus && form.turn > 0) region.current?.focus();
  }, [form.turn]);
  if (entries.length === 0) return null;
  return (
    <div ref={region} class="problems" role="region" aria-label={heading} tabIndex={-1}>
      <h2>{heading}</h2>
      <ul>
        {entries.map(([field, message]) => (
          <li key={field}>
            <a
              href={`#${form.ids[field]}`}
              onClick={(event) => {
                event.preventDefault();
                document.getElementById(form.ids[field] as string)?.focus();
              }}
            >
              {message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface AsyncButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "label"> {
  label: string;
  primary?: boolean;
  /** Text and name while the request is open: F-01, or C22 on the client page. */
  busyLabel?: string;
  onPress: (button: HTMLButtonElement) => Promise<unknown>;
  children?: ComponentChildren;
}

/** While its request is open the button reads F-01, carries aria-disabled and never `disabled`, a further press does nothing, and focus stays (SR11). */
export function AsyncButton({ label, primary, busyLabel = copy("F-01"), onPress, class: className, ...rest }: AsyncButtonProps): JSX.Element {
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const self = useRef<HTMLButtonElement>(null);
  const press = async (): Promise<void> => {
    if (running.current || !self.current) return;
    running.current = true;
    self.current.style.minWidth = `${self.current.offsetWidth}px`;
    setBusy(true);
    try {
      await onPress(self.current);
    } finally {
      running.current = false;
      if (self.current) self.current.style.minWidth = "";
      setBusy(false);
    }
  };
  return (
    <button ref={self} type="button" class={`button ${primary ? "button--primary" : ""} ${className ?? ""}`} aria-disabled={busy ? "true" : undefined} onClick={() => void press()} {...rest}>
      {busy ? busyLabel : label}
    </button>
  );
}
