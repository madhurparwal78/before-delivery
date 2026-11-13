import type { ComponentChildren } from 'preact';
import { copy } from '../../shared/copy.js';

interface FieldProps {
  id: string;
  label: string;
  value: string;
  onInput: (value: string) => void;
  type?: 'text' | 'email' | 'password' | 'date' | 'search' | 'tel';
  problem?: string | undefined;
  autoComplete?: string;
  inputMode?: 'text' | 'numeric' | 'decimal' | 'email' | 'tel';
}

export function Field({
  id,
  label,
  value,
  onInput,
  type = 'text',
  problem,
  autoComplete,
  inputMode,
}: FieldProps) {
  return (
    <p class="field">
      <label class="field__label" for={id}>
        {label}
      </label>
      <input
        id={id}
        class="field__input"
        type={type}
        value={value}
        {...(autoComplete === undefined ? {} : { autocomplete: autoComplete })}
        {...(inputMode === undefined ? {} : { inputMode })}
        {...(problem === undefined ? {} : { 'aria-describedby': `${id}-problem`, 'aria-invalid': 'true' })}
        onInput={(event) => onInput((event.currentTarget as HTMLInputElement).value)}
      />
      {problem === undefined ? null : (
        <span id={`${id}-problem`} class="field__problem">
          {problem}
        </span>
      )}
    </p>
  );
}

interface SelectProps {
  id: string;
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  problem?: string | undefined;
}

export function Select({ id, label, value, options, onChange, problem }: SelectProps) {
  return (
    <p class="field">
      <label class="field__label" for={id}>
        {label}
      </label>
      <select
        id={id}
        class="field__input"
        value={value}
        {...(problem === undefined ? {} : { 'aria-describedby': `${id}-problem`, 'aria-invalid': 'true' })}
        onChange={(event) => onChange((event.currentTarget as HTMLSelectElement).value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {problem === undefined ? null : (
        <span id={`${id}-problem`} class="field__problem">
          {problem}
        </span>
      )}
    </p>
  );
}

interface RadioGroupProps {
  id: string;
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  problem?: string | undefined;
  columns?: boolean;
}

export function RadioGroup({
  id,
  label,
  value,
  options,
  onChange,
  problem,
  columns = false,
}: RadioGroupProps) {
  return (
    <fieldset
      class={`radiogroup ${columns ? 'radiogroup--columns' : ''}`}
      role="radiogroup"
      aria-label={label}
      {...(problem === undefined ? {} : { 'aria-describedby': `${id}-problem` })}
    >
      <legend class="radiogroup__legend">{label}</legend>
      {options.map((option, index) => (
        <label key={option.value} class="radio">
          <input
            {...(index === 0 ? { id } : {})}
            type="radio"
            name={id}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
          />
          <span class="radio__label">{option.label}</span>
        </label>
      ))}
      {problem === undefined ? null : (
        <span id={`${id}-problem`} class="field__problem">
          {problem}
        </span>
      )}
    </fieldset>
  );
}

interface ActionButtonProps {
  label: string;
  onPress: () => void;
  pending?: boolean;
  variant?: 'primary' | 'quiet' | 'danger';
  buttonRef?: (node: HTMLButtonElement | null) => void;
  describedBy?: string;
}

/** Every async action shows a pending state: disabled and reading `Working…`. */
export function ActionButton({
  label,
  onPress,
  pending = false,
  variant = 'primary',
  buttonRef,
  describedBy,
}: ActionButtonProps) {
  return (
    <button
      ref={buttonRef}
      type="button"
      class={`button button--${variant}`}
      disabled={pending}
      aria-label={label}
      {...(describedBy === undefined ? {} : { 'aria-describedby': describedBy })}
      onClick={onPress}
    >
      {pending ? copy.working : label}
    </button>
  );
}

export function DialogActions({ children }: { children: ComponentChildren }) {
  return <div class="dialog__actions">{children}</div>;
}
