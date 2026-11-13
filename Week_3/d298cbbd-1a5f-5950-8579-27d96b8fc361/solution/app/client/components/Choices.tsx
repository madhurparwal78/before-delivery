import type { JSX } from "preact";

interface RadioProps<T extends string | number> {
  readonly label: string;
  readonly name: string;
  readonly value: T;
  readonly options: readonly T[];
  readonly onChange: (value: T) => void;
  readonly class?: string;
}

/** A group of radios drawn as tabs: the native input lies over its label, so the control itself is what a pointer hits. */
export function RadioGroup<T extends string | number>({ label, name, value, options, onChange, class: className }: RadioProps<T>): JSX.Element {
  return (
    <div class={`choice-group ${className ?? ""}`} role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <label class="choice" key={option}>
          <input type="radio" name={name} value={String(option)} checked={option === value} onChange={() => onChange(option)} />
          <span class="choice-face">{option}</span>
        </label>
      ))}
    </div>
  );
}

export function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }): JSX.Element {
  return (
    <label class="choice choice-box">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.currentTarget.checked)} />
      <span class="choice-face">{label}</span>
    </label>
  );
}
