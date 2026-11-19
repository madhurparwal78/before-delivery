import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { formatNumber } from '../../shared/display.ts';
import type { ParameterDef, ParameterValue } from '../../shared/model.ts';
import './controls.css';

/** `{name} set to {value}.`, the value written by the display rule. */
export function parameterCopy(name: string, value: ParameterValue): string {
  return `${name} set to ${typeof value === 'number' ? formatNumber(value) : value}.`;
}

interface ParameterControlProps {
  parameter: ParameterDef;
  value: ParameterValue;
  onApply: (value: ParameterValue) => void;
}

/**
 * One parameter: a spinbutton for a number, a combobox for text or a list. The typed value is a draft until Enter or
 * the control losing focus applies it, so no keystroke ever sends a query.
 */
function ParameterControl({ parameter, value, onApply }: ParameterControlProps) {
  const id = useId();
  const [draft, setDraft] = useState(String(value));
  const keyed = useRef(false);

  useEffect(() => setDraft(String(value)), [value]);

  const apply = (text: string) => {
    if (parameter.type === 'number') {
      const number = Number(text);
      if (text.trim() === '' || !Number.isFinite(number)) {
        setDraft(String(value));
        return;
      }
      if (number !== value) onApply(number);
      return;
    }
    if (text !== value) onApply(text);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
    keyed.current = true;
    if (event.key === 'Enter') {
      event.preventDefault();
      apply(event.currentTarget.value);
    }
  };

  const label = (
    <label htmlFor={id} className="parameter-label">
      {parameter.name}
    </label>
  );

  if (parameter.type === 'list') {
    return (
      <div className="parameter">
        {label}
        <select
          id={id}
          className="control control-select"
          value={draft}
          onKeyDown={onKeyDown}
          onPointerDown={() => {
            keyed.current = false;
          }}
          onChange={(event) => {
            setDraft(event.target.value);
            if (!keyed.current) apply(event.target.value);
          }}
          onBlur={(event) => apply(event.target.value)}
        >
          {parameter.values.map((choice) => (
            <option key={choice} value={choice}>
              {choice}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div className="parameter">
      {label}
      <input
        id={id}
        className="control"
        type={parameter.type === 'number' ? 'number' : 'text'}
        role={parameter.type === 'number' ? undefined : 'combobox'}
        aria-expanded={parameter.type === 'number' ? undefined : false}
        inputMode={parameter.type === 'number' ? 'decimal' : undefined}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={(event) => apply(event.target.value)}
      />
    </div>
  );
}

interface ControlsProps {
  parameters: readonly ParameterDef[];
  /** the page's current value per parameter name */
  values: Readonly<Record<string, ParameterValue>>;
  /** the page stores the value, queries again and shows `parameterCopy(name, value)` in its announcements */
  onApply: (name: string, value: ParameterValue) => void;
  /** further controls of the page (filters, extract state, exports) inside the same region */
  children?: ReactNode;
}

/** `region "Controls"`: one control per workbook parameter, applied on Enter or blur only. */
export function Controls({ parameters, values, onApply, children }: ControlsProps) {
  const headingId = useId();
  return (
    <section className="controls" role="region" aria-labelledby={headingId}>
      <h2 id={headingId} className="controls-title">
        Controls
      </h2>
      {parameters.length > 0 ? (
        <div className="parameters">
          {parameters.map((parameter) => (
            <ParameterControl
              key={parameter.id}
              parameter={parameter}
              value={values[parameter.name] ?? parameter.value}
              onApply={(value) => onApply(parameter.name, value)}
            />
          ))}
        </div>
      ) : null}
      {children}
    </section>
  );
}
