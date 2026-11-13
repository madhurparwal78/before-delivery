import { useRef } from 'react';
import type { ReactNode } from 'react';

export interface FormError {
  field: string;
  message: string;
}

export function FormSummary({ errors }: { errors: FormError[] }) {
  const summary = useRef<HTMLDivElement>(null);
  if (errors.length === 0) return null;
  return (
    <div className="summary" tabIndex={-1} ref={summary} id="form-summary" role="group" aria-label="Problems with this form">
      <ul role="list">
        {errors.map((error) => (
          <li key={error.field}>
            <a
              href={`#${error.field}`}
              onClick={(event) => {
                event.preventDefault();
                document.getElementById(error.field)?.focus();
              }}
            >
              {error.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Column({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`column ${className}`.trim()}>{children}</div>;
}
