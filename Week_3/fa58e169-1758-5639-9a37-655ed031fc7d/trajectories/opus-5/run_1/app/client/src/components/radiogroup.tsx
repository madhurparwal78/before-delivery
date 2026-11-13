export interface RadioOption {
  value: string;
  label: string;
  tile?: string;
  glyph?: JSX.Element | null;
  swatch?: string;
}

interface RadioGroupProps {
  name: string;
  options: RadioOption[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function RadioGroup({ name, options, value, onChange, className }: RadioGroupProps): JSX.Element {
  const move = (step: number): void => {
    const at = options.findIndex((option) => option.value === value);
    const next = options[(at + step + options.length) % options.length];
    if (next) onChange(next.value);
  };

  return (
    <div role="radiogroup" aria-label={name} className={className ?? 'radio-row'}>
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          role="radio"
          aria-checked={option.value === value}
          aria-label={option.label}
          tabIndex={option.value === value ? 0 : -1}
          className={option.value === value ? 'chip chosen' : 'chip'}
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
              event.preventDefault();
              move(1);
            }
            if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
              event.preventDefault();
              move(-1);
            }
          }}
        >
          {option.swatch ? (
            <span className="colour-chip" style={{ backgroundColor: option.swatch }} aria-hidden="true" />
          ) : null}
          {option.tile ? (
            <span className={`tile ${option.tile}`} aria-hidden="true">
              {option.glyph}
            </span>
          ) : null}
          <span className="chip-label">{option.label}</span>
        </button>
      ))}
    </div>
  );
}
