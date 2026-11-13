import { useEffect, useRef } from 'preact/hooks';
import { copy } from '../../shared/copy.js';

export interface Problems {
  /** One message per field, keyed by the field's control id. */
  fields: Record<string, string>;
  /** A refusal the server gave that belongs to no single field. */
  message: string | null;
  key: number;
}

export const noProblems: Problems = { fields: {}, message: null, key: 0 };

export function problemsOf(
  fields: Record<string, string>,
  message: string | null = null,
): Problems {
  return { fields, message, key: Date.now() };
}

export function hasProblems(problems: Problems): boolean {
  return problems.message !== null || Object.keys(problems.fields).length > 0;
}

interface ProblemsSummaryProps {
  problems: Problems;
  /** Maps a field key to the id of the control it belongs to. */
  controlIds: Record<string, string>;
  labels: Record<string, string>;
}

/**
 * On a field problem, focus moves to the Problems summary at the top of the dialog or
 * form, and each link in it moves focus to its field.
 */
export function ProblemsSummary({ problems, controlIds, labels }: ProblemsSummaryProps) {
  const region = useRef<HTMLDivElement>(null);
  useEffect(() => {
    region.current?.focus();
  }, [problems.key]);

  if (!hasProblems(problems)) return null;

  const entries = Object.entries(problems.fields);

  return (
    <div
      ref={region}
      class="problems"
      role="region"
      aria-label="Problems"
      tabIndex={-1}
      data-problems-summary
    >
      <h3 class="problems__heading">{copy.problemHeading}</h3>
      {problems.message === null ? null : <p class="problems__message">{problems.message}</p>}
      {entries.length === 0 ? null : (
        <ul class="problems__list">
          {entries.map(([field, message]) => (
            <li key={field}>
              <a
                href={`#${controlIds[field] ?? field}`}
                onClick={(event) => {
                  event.preventDefault();
                  document.getElementById(controlIds[field] ?? field)?.focus();
                }}
              >
                {labels[field] === undefined ? message : `${labels[field]}: ${message}`}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
