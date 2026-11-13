// Form controls shared by the part rail, the home hero and the publish form.
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { ManifestEntry } from "../shared/api";
import { NNBSP, display, fixed, parseDecimal, roundHalfEven } from "../shared/numbers";
import { Frame } from "./chrome";
import { Icon } from "./icons";
import { clampTo, stepped, unitsPerStep } from "./stepping";

const INCH = 25.4;
export type Units = "mm" | "in";

type SpinEntry = Pick<ManifestEntry, "name" | "label" | "kind" | "unit" | "min" | "max" | "step" | "precision" | "default">;

const UNIT_WORDS: Record<string, string> = { mm: "millimetres", in: "inches", "°": "degrees" };

function grammarMessage(label: string): string {
  return `${label} takes a plain decimal such as 12.5.`;
}

function shownOf(entry: SpinEntry, mm: number, units: Units): number {
  return units === "in" && entry.unit === "mm" ? mm / INCH : mm;
}

function placesOf(entry: SpinEntry, units: Units): number {
  return entry.precision + (units === "in" && entry.unit === "mm" ? 1 : 0);
}

function fieldText(entry: SpinEntry, mm: number, units: Units): string {
  return fixed(shownOf(entry, mm, units), placesOf(entry, units));
}

function WasMarker({ entry }: { entry: SpinEntry }) {
  const value = entry.default;
  let text: string;
  if (typeof value === "boolean") text = `was ${value ? "on" : "off"}`;
  else if (typeof value === "string") text = `was ${value}`;
  else if (entry.kind === "count") text = `was ${display(value, 0)}`;
  else text = `was ${display(value, entry.precision)}${NNBSP}${entry.unit ?? ""}`;
  return <span className="was">{text}</span>;
}

interface SpinProps {
  entry: SpinEntry;
  /** The millimetre (or degree, or count) value. */
  value: number;
  units: Units;
  modified: boolean;
  onCommit: (value: number) => void;
  /** The wide field of the home hero. */
  bare?: boolean;
}

export function Spin({ entry, value, units, modified, onCommit, bare = false }: SpinProps) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const dirty = useRef(false);
  const kept = useRef<{ value: number; units: Units } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const shown = preview ?? value;
  const inches = units === "in" && entry.unit === "mm";

  // A committed value keeps the digits that were typed; any other change to the value shows it at display precision.
  useEffect(() => {
    if (kept.current?.value === value && kept.current.units === units) return;
    kept.current = null;
    dirty.current = false;
    setDraft(null);
    setError(null);
  }, [value, units]);

  const unitWord = entry.kind === "count" ? null : UNIT_WORDS[inches ? "in" : (entry.unit ?? "")] ?? null;
  const places = placesOf(entry, units);
  const valuetext = unitWord ? `${display(shownOf(entry, shown, units), places)}${NNBSP}${unitWord}` : display(shown, 0);
  const machine = (mm: number) => String(shownOf(entry, mm, units));

  const press = (count: number) => {
    dirty.current = false;
    kept.current = null;
    setDraft(null);
    setError(null);
    onCommit(stepped(entry, value, count));
  };

  const commitText = () => {
    const text = draft;
    if (text === null) return;
    dirty.current = false;
    const parsed = parseDecimal(text);
    if (parsed === null) {
      setError(grammarMessage(entry.label));
      return;
    }
    if (entry.kind === "count" && !Number.isInteger(parsed)) {
      setError("Enter a whole number.");
      return;
    }
    const mm = inches ? roundHalfEven(parsed * INCH, 3) : parsed;
    const clamped = clampTo(entry, mm);
    setError(null);
    if (clamped !== mm) setDraft(null);
    else kept.current = { value: clamped, units };
    if (clamped !== value) onCommit(clamped);
  };

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    const modifiers = { fine: event.ctrlKey || event.metaKey, coarse: event.shiftKey };
    const key = event.key;
    let count = 0;
    if (key === "ArrowUp" || key === "ArrowRight") count = unitsPerStep(entry, modifiers);
    else if (key === "ArrowDown" || key === "ArrowLeft") count = -unitsPerStep(entry, modifiers);
    else if (key === "PageUp") count = unitsPerStep(entry, { fine: false, coarse: true });
    else if (key === "PageDown") count = -unitsPerStep(entry, { fine: false, coarse: true });
    else if (key === "Enter") {
      event.preventDefault();
      commitText();
      return;
    } else return;
    event.preventDefault();
    press(count);
  };

  const scrub = useScrub(entry, () => value, (final) => {
    setPreview(null);
    if (final !== null && final !== value) {
      dirty.current = false;
      setDraft(null);
      setError(null);
      onCommit(final);
    }
  }, setPreview);

  return (
    <div className={bare ? "field field-bare" : "field"}>
      <div className="field-row">
        <label htmlFor={id}>{entry.label}</label>
        <div className={modified ? "spin spin-modified" : "spin"}>
          <input
            id={id}
            ref={input}
            type="text"
            role="spinbutton"
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            aria-valuenow={Number(machine(shown))}
            aria-valuetext={valuetext}
            aria-valuemin={entry.min === undefined ? undefined : Number(machine(entry.min))}
            aria-valuemax={entry.max === undefined ? undefined : Number(machine(entry.max))}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            value={draft ?? fieldText(entry, shown, units)}
            onChange={(event) => {
              dirty.current = true;
              setDraft(event.target.value);
            }}
            onBlur={() => dirty.current && commitText()}
            onKeyDown={onKey}
          />
          {entry.unit ? <span className="unit">{inches ? "in" : entry.unit}</span> : null}
          {modified ? <Frame amber /> : null}
        </div>
        <button type="button" className="scrub" aria-label={`Scrub ${entry.label}`} {...scrub}>
          <Icon name="dimension" size={18} />
        </button>
      </div>
      {error ? (
        <p className="field-error" id={`${id}-error`}>
          <Icon name="alert" size={16} />
          {error}
        </p>
      ) : null}
      {modified ? <WasMarker entry={entry} /> : null}
    </div>
  );
}

const PX_PER_STEP = 4;

/** A captured drag: one step per 4 px, committed on release, Escape or a cancelled pointer restores the start. */
function useScrub(entry: SpinEntry, current: () => number, finish: (final: number | null) => void, preview: (value: number | null) => void) {
  const drag = useRef<{ x: number; start: number; id: number; value: number } | null>(null);
  const abandon = useRef<(() => void) | null>(null);
  useEffect(() => () => abandon.current?.(), []);

  const valueAt = (event: { clientX: number; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => {
    const d = drag.current as { x: number; start: number };
    const steps = Math.trunc((event.clientX - d.x) / PX_PER_STEP);
    const per = unitsPerStep(entry, { fine: event.ctrlKey || event.metaKey, coarse: event.shiftKey });
    return stepped(entry, d.start, steps * per);
  };

  return {
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0 && event.pointerType === "mouse") return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { x: event.clientX, start: current(), id: event.pointerId, value: current() };
      const onKey = (key: globalThis.KeyboardEvent) => {
        if (key.key !== "Escape" || !drag.current) return;
        drag.current = null;
        preview(null);
        finish(null);
      };
      document.addEventListener("keydown", onKey, true);
      abandon.current = () => document.removeEventListener("keydown", onKey, true);
    },
    onPointerMove: (event: React.PointerEvent<HTMLButtonElement>) => {
      const d = drag.current;
      if (d?.id !== event.pointerId) return;
      d.value = valueAt(event);
      preview(d.value);
    },
    onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => {
      abandon.current?.();
      if (drag.current?.id !== event.pointerId) return;
      const final = drag.current.value;
      drag.current = null;
      finish(final);
    },
    onPointerCancel: (event: React.PointerEvent<HTMLButtonElement>) => {
      abandon.current?.();
      if (drag.current?.id !== event.pointerId) return;
      drag.current = null;
      preview(null);
      finish(null);
    },
  };
}

export function RadioGroup<T extends string>({ label, name, value, options, onChange, className = "" }: { label: string; name: string; value: T; options: { value: T; label: string; face?: ReactNode }[]; onChange: (value: T) => void; className?: string }) {
  return (
    <div className={`radio-group ${className}`} role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <label key={option.value} className="radio">
          <input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} aria-label={option.label} />
          <span className="radio-face">{option.face ?? option.label}</span>
        </label>
      ))}
    </div>
  );
}

export function SwitchField({ entry, value, modified, onChange }: { entry: ManifestEntry; value: boolean; modified: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="field">
      <div className="field-row">
        <span className="field-label">{entry.label}</span>
        <div className={modified ? "spin spin-modified" : "spin"}>
          <button type="button" role="switch" aria-checked={value} aria-label={entry.label} className="switch" onClick={() => onChange(!value)}>
            <span className="switch-knob" />
            <span className="switch-text">{value ? "on" : "off"}</span>
          </button>
          {modified ? <Frame amber /> : null}
        </div>
      </div>
      {modified ? <WasMarker entry={entry} /> : null}
    </div>
  );
}

export function EnumField({ entry, value, modified, onChange }: { entry: ManifestEntry; value: string; modified: boolean; onChange: (value: string) => void }) {
  const options = entry.options ?? [];
  const id = useId();
  return (
    <div className="field">
      <div className="field-row">
        {options.length <= 3 ? <span className="field-label">{entry.label}</span> : <label htmlFor={id}>{entry.label}</label>}
        <div className={modified ? "spin spin-modified" : "spin"}>
          {options.length <= 3 ? (
            <RadioGroup label={entry.label} name={`enum-${entry.name}`} value={value} options={options.map((o) => ({ value: o, label: o }))} onChange={onChange} />
          ) : (
            <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
              {options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          )}
          {modified ? <Frame amber /> : null}
        </div>
      </div>
      {modified ? <WasMarker entry={entry} /> : null}
    </div>
  );
}
