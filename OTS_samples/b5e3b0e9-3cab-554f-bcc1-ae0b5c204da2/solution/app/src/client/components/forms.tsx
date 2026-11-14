import type { JSX } from "preact";
import { useState } from "preact/hooks";
import { ApiFailure } from "../api.ts";

interface FormState {
  pending: string;
  success: string;
  errors: Record<string, string>;
  failure: string;
}

const idle: FormState = { pending: "", success: "", errors: {}, failure: "" };

export function useForm() {
  const [state, setState] = useState<FormState>(idle);
  return {
    state,
    /** Shows the pending words and clears the last outcome. */
    begin: (pending: string) => setState({ ...idle, pending }),
    succeed: (success: string) => setState({ ...idle, success }),
    /** Field errors go to the summary and the fields; anything else is the failure message. */
    fail: (error: unknown) => {
      if (error instanceof ApiFailure && Object.keys(error.errors).length > 0) setState({ ...idle, errors: error.errors });
      else setState({ ...idle, failure: error instanceof Error ? error.message : "Something went wrong. Try again shortly." });
    },
    reset: () => setState(idle),
  };
}

interface FeedbackProps {
  form: ReturnType<typeof useForm>;
  /** Fields by name, to label the links of the error summary. */
  fields?: Record<string, string>;
  /** When set, the failure is shown in a permanent alert of this name. */
  alertName?: string;
}

const focusField = (id: string) => (event: Event) => {
  event.preventDefault();
  document.getElementById(id)?.focus();
};

/** `Form status`, the field error summary and the failure alert of one form. */
export function FormFeedback({ form, fields = {}, alertName }: FeedbackProps) {
  const { state } = form;
  const entries = Object.entries(state.errors);
  return (
    <div class="feedback">
      <p role="status" aria-label="Form status" class="form-status">
        {state.pending || state.success}
      </p>
      {entries.length > 0 && (
        <div role="alert" aria-label="Form errors" class="cell-error">
          <p class="state-word">Fix these fields</p>
          <ul>
            {entries.map(([name, message]) => (
              <li key={name}>
                <a href={`#field-${name}`} onClick={focusField(`field-${name}`)}>
                  {fields[name] ?? name}: {message}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
      {alertName !== undefined ? (
        <div role="alert" aria-label={alertName} class={state.failure ? "cell-error" : "cell-quiet"}>
          {state.failure}
        </div>
      ) : (
        state.failure && (
          <div role="alert" class="cell-error">
            {state.failure}
          </div>
        )
      )}
    </div>
  );
}

interface FieldProps {
  name: string;
  label: string;
  value: string;
  onInput: (value: string) => void;
  error?: string | undefined;
  type?: "text" | "password" | "email";
  autoComplete?: string;
  placeholder?: string;
  inputMode?: JSX.HTMLAttributes<HTMLInputElement>["inputMode"];
}

export function TextField({ name, label, value, onInput, error, type = "text", autoComplete, placeholder, inputMode }: FieldProps) {
  const id = `field-${name}`;
  return (
    <div class="field">
      <label for={id}>{label}</label>
      <input
        id={id}
        name={name}
        type={type}
        value={value}
        autoComplete={autoComplete}
        placeholder={placeholder}
        inputMode={inputMode}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onInput={(event) => onInput(event.currentTarget.value)}
      />
      {error && (
        <p id={`${id}-error`} class="field-error">
          {error}
        </p>
      )}
    </div>
  );
}
