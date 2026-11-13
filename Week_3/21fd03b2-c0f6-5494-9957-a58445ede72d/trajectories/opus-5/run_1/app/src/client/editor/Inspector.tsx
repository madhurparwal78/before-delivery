import { useEffect, useRef, useState } from 'react';
import { lockNoticeCopy } from '../../shared/copy.js';
import {
  GRAVITY_SPEC,
  POSITION_LABELS,
  formatSI,
  inRange,
  parseParameterText,
  rangeMessage,
  specsFor,
  type ParamSpec,
} from '../../shared/params.js';
import { derivedReadouts, readoutText, type ParamValues } from '../../shared/readouts.js';
import type { SceneDocument, SceneObject } from '../../shared/scene.js';

const SURFACES: readonly { label: string; friction: number }[] = [
  { label: 'Frictionless', friction: 0 },
  { label: 'Ice', friction: 0.05 },
  { label: 'Polished wood', friction: 0.2 },
  { label: 'Rubber mat', friction: 0.8 },
];

const POSITION_SPEC: ParamSpec = {
  key: 'position',
  label: 'Position',
  min: -500,
  max: 500,
  def: 0,
  step: 0.1,
  units: 'length',
};

interface FieldProps {
  label: string;
  spec: ParamSpec;
  value: number;
  readOnly: boolean;
  onPreview: (value: number | null) => void;
  onCommit: (value: number) => void;
  onError: (invalid: boolean) => void;
}

/** A parameter field: unit suffixes, the SI value on blur, and its own field error. */
function ParameterField(props: FieldProps): JSX.Element {
  const [text, setText] = useState(formatSI(props.value));
  const [error, setError] = useState<string | null>(null);
  const focused = useRef(false);
  const timer = useRef(0);

  useEffect(() => {
    if (!focused.current) setText(formatSI(props.value));
  }, [props.value]);

  const judge = (next: string): { value: number | null; message: string | null } => {
    const parsed = parseParameterText(next, props.spec.units);
    if (!parsed.ok) return { value: null, message: parsed.message };
    if (!inRange(props.spec, parsed.value))
      return { value: null, message: rangeMessage(props.spec) };
    return { value: parsed.value, message: null };
  };

  const onChange = (next: string): void => {
    setText(next);
    const verdict = judge(next);
    setError(verdict.message);
    props.onPreview(verdict.value);
    props.onError(verdict.message !== null);
    window.clearTimeout(timer.current);
    if (verdict.value !== null) {
      const value = verdict.value;
      timer.current = window.setTimeout(() => props.onCommit(value), 500);
    }
  };

  const id = `field-${props.label.replace(/[^a-z]/gi, '-').toLowerCase()}`;
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      <input
        id={id}
        type="text"
        role="spinbutton"
        aria-label={props.label}
        aria-valuenow={props.value}
        aria-valuemin={props.spec.min}
        aria-valuemax={props.spec.max}
        aria-invalid={error !== null ? true : undefined}
        className="num"
        value={text}
        readOnly={props.readOnly}
        onFocus={() => {
          focused.current = true;
        }}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            const verdict = judge(text);
            if (verdict.value !== null) {
              window.clearTimeout(timer.current);
              props.onCommit(verdict.value);
              setText(formatSI(verdict.value));
            }
            return;
          }
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            const step = event.key === 'ArrowUp' ? props.spec.step : -props.spec.step;
            const next = Math.round((props.value + step) * 1e6) / 1e6;
            if (inRange(props.spec, next)) {
              setText(formatSI(next));
              props.onPreview(next);
              props.onCommit(next);
            }
          }
        }}
        onBlur={() => {
          focused.current = false;
          const verdict = judge(text);
          if (verdict.value !== null) {
            window.clearTimeout(timer.current);
            props.onCommit(verdict.value);
            setText(formatSI(verdict.value));
            setError(null);
            props.onError(false);
          }
        }}
      />
      {error ? <span className="field-error">{error}</span> : null}
    </div>
  );
}

export interface InspectorProps {
  document: SceneDocument;
  selected: SceneObject | null;
  readOnly: boolean;
  lockHolder: { userId: string; displayName: string } | null;
  onSetParam: (objectId: string, key: string, value: number) => void;
  onSetPosition: (objectId: string, axis: number, value: number) => void;
  onSetSceneName: (name: string) => void;
  onSetGravity: (value: number) => void;
  onFieldError: (key: string, invalid: boolean) => void;
}

export function Inspector(props: InspectorProps): JSX.Element {
  const [previews, setPreviews] = useState<Record<string, number | null>>({});
  const [materialOpen, setMaterialOpen] = useState(false);
  const materialButton = useRef<HTMLButtonElement | null>(null);
  const popover = useRef<HTMLDivElement | null>(null);
  const object = props.selected;

  useEffect(() => {
    setPreviews({});
    setMaterialOpen(false);
  }, [object?.id]);

  useEffect(() => {
    if (!materialOpen) return;
    const first = popover.current?.querySelector<HTMLInputElement>('input');
    first?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setMaterialOpen(false);
        materialButton.current?.focus();
        return;
      }
      if (event.key !== 'Tab') return;
      const options = [...(popover.current?.querySelectorAll<HTMLInputElement>('input') ?? [])];
      if (options.length === 0) return;
      event.preventDefault();
      const index = options.indexOf(document.activeElement as HTMLInputElement);
      const next = (index + (event.shiftKey ? -1 : 1) + options.length) % options.length;
      options[next].focus();
    };
    popover.current?.addEventListener('keydown', onKey);
    const node = popover.current;
    return () => node?.removeEventListener('keydown', onKey);
  }, [materialOpen]);

  if (!object) {
    return (
      <>
        <div className="field">
          <label htmlFor="scene-name">Scene name</label>
          <input
            id="scene-name"
            type="text"
            aria-label="Scene name"
            defaultValue={props.document.name}
            readOnly={props.readOnly}
            onBlur={(event) => {
              const name = event.target.value.trim();
              if (name !== '' && name !== props.document.name) props.onSetSceneName(name);
            }}
          />
        </div>
        <ParameterField
          label="Gravity (m/s²)"
          spec={GRAVITY_SPEC}
          value={props.document.gravity}
          readOnly={props.readOnly}
          onPreview={(value) => setPreviews((current) => ({ ...current, gravity: value }))}
          onCommit={(value) => props.onSetGravity(value)}
          onError={(invalid) => props.onFieldError('scene.gravity', invalid)}
        />
      </>
    );
  }

  const gravity = previews.gravity === undefined ? props.document.gravity : previews.gravity;
  const specs = specsFor(object.kind);
  const values: ParamValues = Object.fromEntries(
    specs.map((spec) => [
      spec.key,
      previews[spec.key] === undefined ? object.params[spec.key] : previews[spec.key],
    ]),
  );
  const readouts = derivedReadouts(object.kind, values, gravity);
  const friction = object.params.friction;

  return (
    <>
      {props.lockHolder ? (
        <p className="lock-notice" role="status" aria-label="Lock notice">
          {lockNoticeCopy(props.lockHolder.displayName, object.name)}
        </p>
      ) : null}

      {props.readOnly ? (
        <div className="value-rows">
          {POSITION_LABELS.map((label, axis) => (
            <span key={label}>{`${label}: ${object.position[axis]}`}</span>
          ))}
          {specs.map((spec) => (
            <span key={spec.key}>{`${spec.label}: ${object.params[spec.key]}`}</span>
          ))}
        </div>
      ) : (
        <>
          {POSITION_LABELS.map((label, axis) => (
            <ParameterField
              key={label}
              label={label}
              spec={POSITION_SPEC}
              value={object.position[axis]}
              readOnly={false}
              onPreview={() => undefined}
              onCommit={(value) => props.onSetPosition(object.id, axis, value)}
              onError={(invalid) => props.onFieldError(`${object.id}.position${axis}`, invalid)}
            />
          ))}
          {specs.map((spec) => (
            <ParameterField
              key={spec.key}
              label={spec.label}
              spec={spec}
              value={object.params[spec.key]}
              readOnly={false}
              onPreview={(value) =>
                setPreviews((current) => ({ ...current, [spec.key]: value }))
              }
              onCommit={(value) => props.onSetParam(object.id, spec.key, value)}
              onError={(invalid) =>
                props.onFieldError(`${object.id}.params.${spec.key}`, invalid)
              }
            />
          ))}
          {object.kind === 'ramp' ? (
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                className="chip"
                ref={materialButton}
                onClick={() => setMaterialOpen((value) => !value)}
              >
                Material
              </button>
              {materialOpen ? (
                <div
                  className="popover"
                  role="dialog"
                  aria-label="Material"
                  aria-modal="false"
                  ref={popover}
                >
                  {SURFACES.map((surface) => (
                    <label className="radio-row" key={surface.label}>
                      <input
                        type="radio"
                        name="surface"
                        checked={friction === surface.friction}
                        onChange={() => {
                          props.onSetParam(object.id, 'friction', surface.friction);
                          setMaterialOpen(false);
                          materialButton.current?.focus();
                        }}
                      />
                      {surface.label}
                    </label>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      )}

      {readouts.length > 0 ? (
        <div className="readouts" role="region" aria-label="Derived readouts" aria-live="polite">
          {readouts.map((readout) => (
            <span className="readout" key={readout.label}>
              {readoutText(readout)}
            </span>
          ))}
        </div>
      ) : null}
    </>
  );
}
