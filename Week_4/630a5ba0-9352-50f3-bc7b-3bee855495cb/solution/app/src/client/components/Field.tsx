import { useId, type InputHTMLAttributes, type ReactNode } from "react";

/** A labelled field whose error sits under it and is linked as its description. */
export function Field({ label, error, hint, ...input }: { label: string; error?: string; hint?: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const described = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <input id={id} className="input" aria-invalid={error ? true : undefined} aria-describedby={described} {...input} />
      {hint && (
        <p id={hintId} className="field-hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}

function zones(): string[] {
  const list = Intl.supportedValuesOf("timeZone");
  return list.includes("UTC") ? list : ["UTC", ...list];
}

export function browserZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function ZoneSelect({ value, onChange, error }: { value: string; onChange: (zone: string) => void; error?: string }) {
  const id = useId();
  const options = zones();
  const all = options.includes(value) ? options : [value, ...options];
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        Time zone
      </label>
      <select
        id={id}
        className="input select"
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        {all.map((zone) => (
          <option key={zone} value={zone}>
            {zone}
          </option>
        ))}
      </select>
      {error && (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}
