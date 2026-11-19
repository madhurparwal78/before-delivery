import type { ChangeEvent, ReactNode } from "react";
import { guestsLabel } from "../../shared/calendar.js";
import { AlertIcon } from "./Icons.js";

export function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="field-error">
      <AlertIcon />
      <span>{children}</span>
    </p>
  );
}

export function TextField({
  id,
  label,
  value,
  onChange,
  error,
  type = "text",
  autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  type?: "text" | "email" | "password";
  autoComplete?: string;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="input"
        type={type}
        value={value}
        autoComplete={autoComplete}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={error === undefined ? undefined : `${id}-error`}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
      />
      {error !== undefined && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </div>
  );
}

export function PartySize({ value, onChange }: { value: number; onChange: (party: number) => void }) {
  return (
    <fieldset className="party" role="radiogroup" aria-label="Party size">
      {[1, 2, 3, 4, 5, 6, 7, 8].map((party) => (
        <label key={party}>
          <input type="radio" name="party-size" value={party} checked={value === party} onChange={() => onChange(party)} />
          <span>{guestsLabel(party)}</span>
        </label>
      ))}
    </fieldset>
  );
}

export function DateField({
  value,
  min,
  max,
  onChange,
}: {
  value: string;
  min: string;
  max: string;
  onChange: (date: string) => void;
}) {
  return (
    <div className="field">
      <label htmlFor="date">Date</label>
      <input
        id="date"
        className="input"
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          if (event.target.value !== "") onChange(event.target.value);
        }}
      />
    </div>
  );
}
