// The linked summary of field errors: each line moves focus to its field.
import { useEffect, useRef } from "react";

export function ErrorSummary({ errors, fieldId }: { errors: Record<string, string>; fieldId: (key: string) => string }) {
  const ref = useRef<HTMLDivElement>(null);
  const entries = Object.entries(errors);
  useEffect(() => {
    if (entries.length > 0) ref.current?.scrollIntoView({ block: "nearest" });
  }, [errors]);
  if (entries.length === 0) return null;
  return (
    <div className="error-summary" role="alert" ref={ref} aria-labelledby="error-summary-title">
      <h2 id="error-summary-title">Check these fields</h2>
      <ul>
        {entries.map(([key, message]) => (
          <li key={key}>
            <a
              href={`#${fieldId(key)}`}
              onClick={(event) => {
                event.preventDefault();
                const target = document.getElementById(fieldId(key));
                target?.focus();
                target?.scrollIntoView({ block: "center" });
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
