import { forwardRef } from 'react';
import { FORM_PROBLEMS_SUMMARY } from '../../shared/copy';

export interface Problems {
  readonly summary: string;
  readonly fields: readonly { field: string; message: string }[];
}

export function problemsFrom(fields: Record<string, string> | null): Problems | null {
  if (!fields || Object.keys(fields).length === 0) return null;
  return {
    summary: FORM_PROBLEMS_SUMMARY,
    fields: Object.entries(fields).map(([field, message]) => ({ field, message })),
  };
}

export function problemsOf(entries: readonly { field: string; message: string }[]): Problems | null {
  if (entries.length === 0) return null;
  return { summary: FORM_PROBLEMS_SUMMARY, fields: entries };
}

export function messageFor(problems: Problems | null, field: string): string | null {
  return problems?.fields.find((entry) => entry.field === field)?.message ?? null;
}

interface FormProblemsProps {
  readonly problems: Problems | null;
  /** Moves focus to the field a summary link names. */
  readonly onJump: (field: string) => void;
}

/** The one error summary in the page; it takes focus but is not in the Tab order. */
export const FormProblems = forwardRef<HTMLDivElement, FormProblemsProps>(
  function FormProblems({ problems, onJump }, ref): JSX.Element {
    return (
      <div
        ref={ref}
        role="alert"
        aria-label="Form problems"
        tabIndex={-1}
        className={problems ? 'problems' : 'problems problems-empty'}
      >
        {problems ? (
          <>
            <p className="problems-summary">{problems.summary}</p>
            <ul>
              {problems.fields.map((entry) => (
                <li key={entry.field}>
                  <a
                    href={`#field-${entry.field}`}
                    onClick={(event) => {
                      event.preventDefault();
                      onJump(entry.field);
                    }}
                  >
                    {entry.message}
                  </a>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    );
  },
);

export function FieldMessage({ message }: { readonly message: string | null }): JSX.Element | null {
  return message === null ? null : <p className="field-message">{message}</p>;
}
