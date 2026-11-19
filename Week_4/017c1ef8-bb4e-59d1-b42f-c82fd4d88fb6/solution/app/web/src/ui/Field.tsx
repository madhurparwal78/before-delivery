import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';

interface FieldBase {
  label: string;
  /** The field's name; its id is `field-<name>` unless `id` is given (the error summary links to it). */
  name: string;
  /** The message shown under the field, such as a 422 field message. */
  error?: string;
  /** Muted help text under the label. */
  hint?: string;
}

type InputField = FieldBase & { multiline?: false } & Omit<InputHTMLAttributes<HTMLInputElement>, 'name'>;
type TextField = FieldBase & { multiline: true } & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'name'>;

const fieldId = (name: string): string => `field-${name}`;

/** A labelled input or textarea with its message under it. The label is the control's accessible name. */
export const Field = forwardRef<HTMLInputElement | HTMLTextAreaElement, InputField | TextField>(function Field(props, ref) {
  const { label, name, error, hint, multiline, id: givenId, className, ...rest } = props;
  const id = givenId ?? fieldId(name);
  const messageId = `${id}-message`;
  const describedBy = [error ? messageId : '', hint ? `${id}-hint` : ''].filter(Boolean).join(' ') || undefined;
  const shared = { id, name, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy, className: className ?? 'input' };
  return (
    <div className="field">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      {hint ? (
        <p id={`${id}-hint`} className="field-hint">
          {hint}
        </p>
      ) : null}
      {multiline ? (
        <textarea ref={ref as React.Ref<HTMLTextAreaElement>} {...shared} {...(rest as TextareaHTMLAttributes<HTMLTextAreaElement>)} />
      ) : (
        <input ref={ref as React.Ref<HTMLInputElement>} {...shared} {...(rest as InputHTMLAttributes<HTMLInputElement>)} />
      )}
      {error ? (
        <p id={messageId} className="field-message">
          {error}
        </p>
      ) : null}
    </div>
  );
});

export interface FieldProblem {
  name: string;
  label: string;
  message: string;
}

/** The alert at the top of a form: links to each field in error. */
export function FieldErrorSummary({ problems }: { problems: FieldProblem[] }) {
  if (problems.length === 0) return null;
  return (
    <div role="alert" className="alert">
      <ul className="plain-list">
        {problems.map((problem) => (
          <li key={problem.name}>
            <a
              href={`#${fieldId(problem.name)}`}
              onClick={(event) => {
                event.preventDefault();
                document.getElementById(fieldId(problem.name))?.focus();
              }}
            >
              {problem.label}: {problem.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
