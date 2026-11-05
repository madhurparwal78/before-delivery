import { forwardRef } from "react";

export interface CardValue {
  number: string;
  expiry: string;
  cvc: string;
}

export const EMPTY_CARD: CardValue = { number: "", expiry: "", cvc: "" };

/** The three card fields with their field messages; card numbers are never stored. */
export const CardFields = forwardRef<HTMLInputElement, {
  idPrefix: string;
  value: CardValue;
  errors: Record<string, string>;
  onChange: (value: CardValue) => void;
}>(function CardFields({ idPrefix, value, errors, onChange }, numberRef) {
  const field = (name: keyof CardValue, label: string, props: Record<string, string>) => {
    const id = `${idPrefix}-${name}`;
    return (
      <div className={`field field--${name}`}>
        <label htmlFor={id}>{label}</label>
        <input
          id={id}
          ref={name === "number" ? numberRef : undefined}
          value={value[name]}
          onChange={(event) => onChange({ ...value, [name]: event.target.value })}
          aria-invalid={errors[name] ? true : undefined}
          aria-describedby={errors[name] ? `${id}-error` : undefined}
          {...props}
        />
        {errors[name] ? (
          <p id={`${id}-error`} className="field-error">
            {errors[name]}
          </p>
        ) : null}
      </div>
    );
  };
  return (
    <div className="card-fields">
      {field("number", "Card number", { inputMode: "numeric", autoComplete: "cc-number", placeholder: "1234 5678 9012 3456" })}
      {field("expiry", "Expiry (MM/YY)", { inputMode: "numeric", autoComplete: "cc-exp", placeholder: "MM/YY" })}
      {field("cvc", "CVC", { inputMode: "numeric", autoComplete: "cc-csc", placeholder: "3 digits" })}
      <p className="field-hint card-fields__hint">
        Cards are simulated. <span className="mono">4242 4242 4242 4242</span> approves; <span className="mono">4000 0000 0000 0002</span> declines.
      </p>
    </div>
  );
});
