import { pageCopy } from '../../shared/copy.js';

export interface ErrorSummaryProps {
  /** Field key to message, plus an optional form-level message. */
  fields: Record<string, string>;
  formError?: string;
  /** Field key to the id of its control. */
  ids: Record<string, string>;
}

export function ErrorSummary({ fields, formError, ids }: ErrorSummaryProps): JSX.Element | null {
  const keys = Object.keys(fields);
  if (keys.length === 0 && !formError) return null;
  return (
    <div role="alert" className="panel" style={{ borderColor: 'var(--danger)', marginBottom: 10 }}>
      <div className="panel-body">
        <h2 className="danger-text">{pageCopy.problem}</h2>
        {formError ? <p className="danger-text">{formError}</p> : null}
        <ul className="list">
          {keys.map((key) => (
            <li key={key}>
              <a
                href={`#${ids[key] ?? ''}`}
                onClick={(event) => {
                  event.preventDefault();
                  document.getElementById(ids[key] ?? '')?.focus();
                }}
              >
                {fields[key]}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
