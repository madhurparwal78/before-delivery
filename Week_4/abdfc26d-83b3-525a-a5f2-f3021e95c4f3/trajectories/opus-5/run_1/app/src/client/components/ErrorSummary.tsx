import { errorSummary } from '../../shared/copy.js';

/**
 * The error summary any form with field errors shows at its top, with links to
 * each field. It is the only `alert` on a screen.
 */
export function ErrorSummary({
  errors,
  labels,
}: {
  errors: Readonly<Record<string, string>>;
  labels: Readonly<Record<string, string>>;
}): JSX.Element | null {
  const keys = Object.keys(errors);
  if (keys.length === 0) return null;

  return (
    <div className="error-summary" role="alert">
      <p className="error-summary__title">{errorSummary(keys.length)}</p>
      <ul className="error-summary__list">
        {keys.map((key) => (
          <li key={key}>
            <a
              href={`#${key}`}
              onClick={(event) => {
                event.preventDefault();
                document.getElementById(key)?.focus();
              }}
            >
              {labels[key] ?? key}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
