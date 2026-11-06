import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { COPY } from "../copy";

export interface FieldProblem {
  /** The id of the field the link moves focus to. */
  target: string;
  message: string;
}

/**
 * The error summary at the top of a form: one link per field error, named by the field's label,
 * that moves focus to the field, where the message itself sits. Focused when it appears.
 */
export function ErrorSummary({ problems }: { problems: FieldProblem[] }) {
  const headingId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [labels, setLabels] = useState<Record<string, string>>({});
  useLayoutEffect(() => {
    setLabels(
      Object.fromEntries(
        problems.map((problem) => [problem.target, document.querySelector(`label[for="${CSS.escape(problem.target)}"]`)?.textContent?.trim() ?? ""]),
      ),
    );
  }, [problems]);
  useEffect(() => {
    if (problems.length > 0) ref.current?.focus();
  }, [problems]);
  if (problems.length === 0) return null;
  return (
    <div ref={ref} className="error-summary" role="alert" aria-labelledby={headingId} tabIndex={-1}>
      <h2 id={headingId}>{COPY.problem}</h2>
      <ul>
        {problems.map((problem) => (
          <li key={problem.target + problem.message}>
            <a
              href={`#${problem.target}`}
              onClick={(event) => {
                event.preventDefault();
                document.getElementById(problem.target)?.focus();
              }}
            >
              {labels[problem.target] ? `Check ${labels[problem.target]}` : problem.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <p className="field-error" id={id}>
      {message}
    </p>
  );
}
