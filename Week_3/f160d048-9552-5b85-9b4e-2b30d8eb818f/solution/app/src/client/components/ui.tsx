import { CircleAlert } from "lucide-react";
import { useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type Ref, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

export function ActionButton({ busy, children, className = "btn", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return (
    <>
      <button className={className} {...rest} disabled={busy || rest.disabled}>
        {children}
      </button>
      {busy ? <span className="working">Working</span> : null}
    </>
  );
}

export function FieldError({ id, children }: { id: string; children?: ReactNode }) {
  if (!children) return null;
  return (
    <p className="error" id={id}>
      <CircleAlert size={18} aria-hidden="true" style={{ flex: "none", marginTop: 4 }} />
      <span>{children}</span>
    </p>
  );
}

type Shared = { label: string; error?: string; hint?: string; fieldRef?: Ref<never> };

export function TextField({ label, error, hint, inputRef, ...rest }: Shared & InputHTMLAttributes<HTMLInputElement> & { inputRef?: Ref<HTMLInputElement> }) {
  const id = useId();
  const described = [error ? `${id}-error` : "", hint ? `${id}-hint` : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} ref={inputRef} aria-describedby={described} aria-invalid={error ? true : undefined} {...rest} />
      {hint ? <p className="hint" id={`${id}-hint`}>{hint}</p> : null}
      <FieldError id={`${id}-error`}>{error}</FieldError>
    </div>
  );
}

export function TextArea({ label, error, hint, inputRef, ...rest }: Shared & TextareaHTMLAttributes<HTMLTextAreaElement> & { inputRef?: Ref<HTMLTextAreaElement> }) {
  const id = useId();
  const described = [error ? `${id}-error` : "", hint ? `${id}-hint` : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <textarea id={id} ref={inputRef} aria-describedby={described} aria-invalid={error ? true : undefined} {...rest} />
      {hint ? <p className="hint" id={`${id}-hint`}>{hint}</p> : null}
      <FieldError id={`${id}-error`}>{error}</FieldError>
    </div>
  );
}

export function SelectField({
  label, error, inputRef, placeholder, options, ...rest
}: Shared & SelectHTMLAttributes<HTMLSelectElement> & { inputRef?: Ref<HTMLSelectElement>; placeholder: string; options: readonly { id: string; name: string }[] }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} ref={inputRef} aria-describedby={error ? `${id}-error` : undefined} aria-invalid={error ? true : undefined} {...rest}>
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
      <FieldError id={`${id}-error`}>{error}</FieldError>
    </div>
  );
}

/** A group of native radios drawn as square buttons. */
export function Choices({
  legend, name, value, onChange, options, error, firstRef,
}: {
  legend: string; name: string; value: string; onChange: (id: string) => void; options: readonly { id: string; name: string }[];
  error?: string; firstRef?: Ref<HTMLInputElement>;
}) {
  const id = useId();
  return (
    <fieldset role="radiogroup" aria-label={legend} aria-describedby={error ? `${id}-error` : undefined}>
      <legend>{legend}</legend>
      <div className="choices">
        {options.map((option, index) => (
          <label className="choice" key={option.id}>
            <input
              type="radio"
              name={name}
              ref={index === 0 ? firstRef : undefined}
              value={option.id}
              checked={value === option.id}
              onChange={() => onChange(option.id)}
              aria-label={option.name}
            />
            <span aria-hidden="true">{option.name}</span>
          </label>
        ))}
      </div>
      <FieldError id={`${id}-error`}>{error}</FieldError>
    </fieldset>
  );
}

/** A full-width teal band for errors, outages and conflicts. */
export function Band({ children }: { children: ReactNode }) {
  return (
    <div className="band" role="alert">
      <p>{children}</p>
    </div>
  );
}
