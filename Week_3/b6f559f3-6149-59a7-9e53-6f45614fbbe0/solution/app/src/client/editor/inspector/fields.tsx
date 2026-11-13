import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link2, Link2Off, RotateCcw } from 'lucide-react';
import { checkValue } from '../../../shared/document';
import { COLOUR_PATTERN, normaliseColour, roundTo } from '../../../shared/format';
import { boundTo, clamped, MESSAGES } from '../../../shared/messages';
import type { PropertyDef } from '../../../shared/properties';
import { format, useFieldEnv } from './env';

/** Label, control, reset and bind buttons, and the notes under one field. */
export function FieldFrame({ def, children, bindable = true }: { def: PropertyDef; children: (id: string, readOnly: boolean) => ReactNode; bindable?: boolean }) {
  const env = useFieldEnv();
  const id = useId();
  const [picking, setPicking] = useState(false);
  const bindButton = useRef<HTMLButtonElement>(null);
  const binding = env.bindingOf(def.path);
  const bound = env.bound[def.path];
  const error = env.errors[def.path];
  const overridden = env.isOverridden(def.path);
  const options = env.compatible(def);
  const canBind = bindable && env.target.kind === 'layer';

  return (
    <div className="field-frame" data-field={def.path}>
      <label htmlFor={id} className="field-name">
        {def.label}
      </label>
      <div className="field-control">{children(id, binding !== null || env.viewer)}</div>
      <div className="field-actions">
        {overridden && !env.viewer && (
          <button type="button" className="icon-button" aria-label={`Reset ${def.label} to inherited value`} title="Reset to inherited value" onClick={() => env.reset(def.path)}>
            <RotateCcw size={16} aria-hidden="true" />
          </button>
        )}
        {canBind && !env.viewer && (
          <button
            ref={bindButton}
            type="button"
            className="icon-button"
            aria-label={`${binding ? 'Unbind' : 'Bind'} ${def.label}`}
            aria-haspopup={binding ? undefined : 'menu'}
            aria-expanded={binding ? undefined : picking}
            onClick={() => (binding ? env.unbind(binding.property) : setPicking((open) => !open))}
          >
            {binding ? <Link2Off size={16} aria-hidden="true" /> : <Link2 size={16} aria-hidden="true" />}
          </button>
        )}
      </div>
      {picking && !binding && (
        <div
          role="menu"
          aria-label={`Variables for ${def.label}`}
          className="bind-menu"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              setPicking(false);
              bindButton.current?.focus();
            }
          }}
        >
          {options.length === 0 && <p className="muted bind-empty">No compatible variable.</p>}
          {options.map(({ variable, property }, index) => (
            <button
              key={variable.name}
              type="button"
              role="menuitem"
              className="bind-item"
              ref={(node) => {
                if (index === 0) node?.focus();
              }}
              onClick={() => {
                env.bind(property, variable.name);
                setPicking(false);
              }}
            >
              {variable.name}
            </button>
          ))}
        </div>
      )}
      {binding && <p className="field-note num">{boundTo(binding.variable)}</p>}
      {bound?.limit !== null && bound?.limit !== undefined && <p className="field-note warn num">{clamped(bound.limit)}</p>}
      {error && (
        <div role="alert" className="notice field-notice">
          {error}
        </div>
      )}
    </div>
  );
}

function parseNumber(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '' || !/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(trimmed)) return null;
  return Number(trimmed);
}

interface SpinInputProps {
  id: string;
  value: number;
  min: number;
  max: number;
  step: number;
  shiftStep: number;
  integer?: boolean;
  readOnly: boolean;
  disabled: boolean;
  describedBy?: string;
  onFocus?: () => void;
  /** Called with the accepted number, or an error text to show. */
  onCommit: (value: number) => string | null;
}

/** A spinbutton: type and press Enter or Tab to commit, ArrowUp and ArrowDown step, Shift steps further. */
export function SpinInput(props: SpinInputProps) {
  const { value, min, max, step, shiftStep, integer, readOnly, disabled } = props;
  const [draft, setDraft] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const commit = (text: string): void => {
    const parsed = parseNumber(text);
    setDraft(null);
    if (parsed === null) {
      setProblem(MESSAGES.invalidValue);
      return;
    }
    const next = integer ? Math.round(parsed) : roundTo(parsed, 3);
    if (next === value) {
      setProblem(null);
      return;
    }
    setProblem(props.onCommit(next));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (readOnly || disabled) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      if (draft !== null) commit(draft);
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const base = draft !== null ? (parseNumber(draft) ?? value) : value;
      const delta = (event.shiftKey ? shiftStep : step) * (event.key === 'ArrowUp' ? 1 : -1);
      const next = Math.min(max, Math.max(min, roundTo(base + delta, 3)));
      setDraft(null);
      if (next !== value) setProblem(props.onCommit(next));
      return;
    }
    if (event.key === 'Escape' && draft !== null) {
      event.stopPropagation();
      setDraft(null);
    }
  };

  return (
    <>
      <input
        id={props.id}
        type="text"
        role="spinbutton"
        inputMode="decimal"
        autoComplete="off"
        className="spin-input"
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-describedby={disabled ? props.describedBy : undefined}
        value={draft ?? format(value)}
        readOnly={readOnly}
        disabled={disabled}
        onFocus={props.onFocus}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (draft !== null && !readOnly) commit(draft);
        }}
      />
      {problem && (
        <div role="alert" className="notice field-notice">
          {problem}
        </div>
      )}
    </>
  );
}

export function NumberField({ def }: { def: PropertyDef }) {
  const env = useFieldEnv();
  const raw = env.values[def.path];
  const value = typeof raw === 'number' ? raw : 0;
  return (
    <FieldFrame def={def}>
      {(id, readOnly) => (
        <SpinInput
          id={id}
          value={value}
          min={def.min as number}
          max={def.max as number}
          step={def.step as number}
          shiftStep={def.shiftStep as number}
          integer={def.integer}
          readOnly={readOnly}
          disabled={env.viewer}
          describedBy={env.describedBy}
          onFocus={() => env.editor.setFocusedProperty(def.path)}
          onCommit={(next) => {
            const refusal = checkValue(def, next);
            if (refusal) return refusal;
            env.commit(def, next);
            return null;
          }}
        />
      )}
    </FieldFrame>
  );
}

function TextField({ def }: { def: PropertyDef }) {
  const env = useFieldEnv();
  const raw = env.values[def.path];
  const stored = typeof raw === 'string' ? raw : '';
  const isColour = def.control === 'colour';
  const [draft, setDraft] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const commit = (text: string): void => {
    setDraft(null);
    const next = isColour ? normaliseColour(text.trim()) : text;
    if (next === stored) {
      setProblem(null);
      return;
    }
    const refusal = isColour && !COLOUR_PATTERN.test(next) ? MESSAGES.colour : checkValue(def, next);
    setProblem(refusal);
    if (!refusal) env.commit(def, next);
  };

  return (
    <FieldFrame def={def} bindable={isColour || def.path === 'text'}>
      {(id, readOnly) => (
        <>
          {isColour && <span className="swatch" style={{ background: COLOUR_PATTERN.test(stored) ? stored : 'transparent' }} aria-hidden="true" />}
          <input
            id={id}
            type="text"
            className={isColour ? 'text-input colour-input' : 'text-input'}
            autoComplete="off"
            spellCheck={false}
            value={draft ?? stored}
            readOnly={readOnly}
            disabled={env.viewer}
            aria-describedby={env.viewer ? env.describedBy : undefined}
            onFocus={() => env.editor.setFocusedProperty(def.path)}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && draft !== null && !readOnly) {
                event.preventDefault();
                commit(draft);
              }
              if (event.key === 'Escape' && draft !== null) {
                event.stopPropagation();
                setDraft(null);
              }
            }}
            onBlur={() => {
              if (draft !== null && !readOnly) commit(draft);
            }}
          />
          {problem && (
            <div role="alert" className="notice field-notice">
              {problem}
            </div>
          )}
        </>
      )}
    </FieldFrame>
  );
}

export function SwitchField({ def, bindable = false }: { def: PropertyDef; bindable?: boolean }) {
  const env = useFieldEnv();
  const checked = env.values[def.path] === true;
  return (
    <FieldFrame def={def} bindable={bindable}>
      {(id, readOnly) => (
        <input
          id={id}
          type="checkbox"
          role="switch"
          className="switch-input"
          checked={checked}
          disabled={env.viewer || readOnly}
          aria-describedby={env.viewer ? env.describedBy : undefined}
          onFocus={() => env.editor.setFocusedProperty(def.path)}
          onChange={(event) => env.commit(def, event.target.checked)}
        />
      )}
    </FieldFrame>
  );
}

export function SelectField({ def, choices }: { def: PropertyDef; choices?: { value: string; label: string }[] }) {
  const env = useFieldEnv();
  const raw = env.values[def.path];
  const value = typeof raw === 'string' ? raw : '';
  const options = choices ?? [...(def.choices ?? [])];
  return (
    <FieldFrame def={def} bindable={false}>
      {(id, readOnly) => (
        <select
          id={id}
          className="select-input"
          value={value}
          disabled={env.viewer || readOnly}
          aria-describedby={env.viewer ? env.describedBy : undefined}
          onFocus={() => env.editor.setFocusedProperty(def.path)}
          onChange={(event) => env.commit(def, event.target.value)}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </FieldFrame>
  );
}

function RadioField({ def }: { def: PropertyDef }) {
  const env = useFieldEnv();
  const value = env.values[def.path];
  const group = useId();
  const overridden = env.isOverridden(def.path);
  return (
    <div className="field-frame radio-frame" data-field={def.path}>
      <span className="field-name" id={`${group}-label`}>
        {def.label}
      </span>
      <div role="radiogroup" aria-labelledby={`${group}-label`} className="radio-group field-control">
        {def.choices?.map((choice) => (
          <label key={choice.value} className="radio-choice">
            <input
              type="radio"
              name={group}
              value={choice.value}
              checked={value === choice.value}
              disabled={env.viewer}
              aria-describedby={env.viewer ? env.describedBy : undefined}
              onFocus={() => env.editor.setFocusedProperty(def.path)}
              onChange={() => env.commit(def, choice.value)}
            />
            <span>{choice.label}</span>
          </label>
        ))}
      </div>
      <div className="field-actions">
        {overridden && !env.viewer && (
          <button type="button" className="icon-button" aria-label={`Reset ${def.label} to inherited value`} onClick={() => env.reset(def.path)}>
            <RotateCcw size={16} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}

/** Dispatches on the definition's control. */
export function Field({ def }: { def: PropertyDef }) {
  switch (def.control) {
    case 'spin':
      return <NumberField def={def} />;
    case 'text':
    case 'colour':
      return <TextField def={def} />;
    case 'switch':
      return <SwitchField def={def} bindable={def.path === 'effect.enabled'} />;
    case 'select':
      return <SelectField def={def} />;
    case 'radio':
      return <RadioField def={def} />;
    case 'custom':
      return null;
  }
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <div role="group" className="inspector-section" aria-labelledby={id}>
      <p id={id} className="section-title">
        {title}
      </p>
      <div className="section-fields">{children}</div>
    </div>
  );
}

;
