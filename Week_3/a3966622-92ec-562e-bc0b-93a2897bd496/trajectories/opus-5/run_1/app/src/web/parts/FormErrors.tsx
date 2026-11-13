/** The shared alert for the order, ladder and tariff forms: each message links to its field. */
export function FormErrors({
  errors,
  prefix,
}: {
  errors: Record<string, string>;
  prefix: string;
}): JSX.Element | null {
  const entries = Object.entries(errors);
  if (entries.length === 0) return null;
  return (
    <div role="alert" aria-label="Form errors" className="alert">
      <ul>
        {entries.map(([field, message]) => (
          <li key={field}>
            <a href={`#${prefix}-${field}`}>{message}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}
