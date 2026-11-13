// The shared `alert "Form errors"`: each message links to the field it is about.

export type FieldErrors = Record<string, string>;

/** Maps API error keys to the id of the control that fixes them. */
export function FormErrors({ errors, fieldIds }: { errors: FieldErrors; fieldIds: Record<string, string> }) {
  const entries = Object.entries(errors);
  return (
    <div role="alert" aria-label="Form errors" className={entries.length ? "form-errors" : "form-errors empty"}>
      {entries.length ? (
        <ul>
          {entries.map(([field, message]) => {
            const id = fieldIds[field];
            return (
              <li key={field}>
                {id ? (
                  <a
                    href={`#${id}`}
                    onClick={(event) => {
                      event.preventDefault();
                      document.getElementById(id)?.focus();
                    }}
                  >
                    {message}
                  </a>
                ) : (
                  message
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

export const countCopy = (errors: FieldErrors): string => `${Object.keys(errors).length} fields need attention`;
