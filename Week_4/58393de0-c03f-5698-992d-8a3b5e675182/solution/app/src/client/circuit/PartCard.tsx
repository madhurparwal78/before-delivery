import { useId, useState, type PointerEvent as ReactPointerEvent } from "react";
import { CircleAlert, RotateCcw, Trash2 } from "lucide-react";
import { OHM, copy } from "../../shared/copy";
import type { CircuitComponent } from "../../shared/types";
import { useStatus } from "../lib/status";
import { parseResistance, parseVoltage, signGlyph, terminalEnd, type TerminalSign } from "./model";
import { PART_ICONS } from "./partIcons";
import { groupName, type PartView } from "./readouts";

export interface PartActions {
  onTerminal: (end: string) => void;
  onTerminalPointer: (end: string, event: ReactPointerEvent) => void;
  onDelete: (label: string) => void;
  onVolts: (label: string, volts: number) => void;
  onOhms: (label: string, ohms: number) => void;
  onToggle: (label: string, closed: boolean) => void;
  onReset: (label: string) => void;
  onSeal: () => void;
}

interface NumberFieldProps {
  label: string;
  value: number;
  parse: (text: string) => number | null;
  rangeCopy: string;
  disabled: boolean;
  onValid: (value: number) => void;
  onSeal: () => void;
}

/** Applies every valid value as it is typed; an invalid one shows the range copy and leaves the circuit alone. */
function NumberField({ label, value, parse, rangeCopy, disabled, onValid, onSeal }: NumberFieldProps) {
  const { announce } = useStatus();
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const invalid = draft !== null && parse(draft) === null;
  return (
    <div className="part-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        className="input figures"
        value={draft ?? String(value)}
        readOnly={disabled}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={invalid ? `${id}-error` : undefined}
        onChange={(event) => {
          const text = event.target.value;
          setDraft(text);
          const parsed = parse(text);
          if (parsed === null) announce(rangeCopy);
          else onValid(parsed);
        }}
        onBlur={() => {
          setDraft(null);
          onSeal();
        }}
      />
      {invalid ? (
        <p className="field-error" id={`${id}-error`}>
          <CircleAlert size={16} aria-hidden="true" />
          <span>{rangeCopy}</span>
        </p>
      ) : null}
    </div>
  );
}

interface TerminalButtonProps {
  label: string;
  sign: TerminalSign;
  pending: boolean;
  disabled: boolean;
  actions: PartActions;
}

function TerminalButton({ label, sign, pending, disabled, actions }: TerminalButtonProps) {
  const end = terminalEnd({ label, sign });
  return (
    <button
      type="button"
      className="terminal-button"
      data-terminal={end}
      aria-label={`${label} ${signGlyph(sign)} terminal`}
      aria-pressed={pending ? true : undefined}
      disabled={disabled}
      onClick={() => actions.onTerminal(end)}
      onPointerDown={(event) => actions.onTerminalPointer(end, event)}
    >
      <span aria-hidden="true">{signGlyph(sign)}</span>
    </button>
  );
}

interface PartCardProps {
  part: CircuitComponent;
  view: PartView;
  pendingEnd: string | null;
  readOnly: boolean;
  actions: PartActions;
  groupRef: (element: HTMLDivElement | null) => void;
}

export function PartCard({ part, view, pendingEnd, readOnly, actions, groupRef }: PartCardProps) {
  const Icon = PART_ICONS[part.type];
  const { label } = part;
  return (
    <div className="part-card card" role="group" aria-label={groupName(view)} tabIndex={-1} ref={groupRef} data-status={view.status}>
      <div className="part-card__head">
        <Icon size={22} aria-hidden="true" className="part-card__icon" />
        <span className="part-card__label">{label}</span>
        <span className="part-card__state figures">{view.words}</span>
        <button type="button" className="icon-button" aria-label={`Delete ${label}`} disabled={readOnly} onClick={() => actions.onDelete(label)}>
          <Trash2 size={20} aria-hidden="true" />
        </button>
      </div>
      <div className="part-card__controls">
        <div className="part-card__terminals">
          {(["+", "-"] as const).map((sign) => (
            <TerminalButton key={sign} label={label} sign={sign} pending={pendingEnd === terminalEnd({ label, sign })} disabled={readOnly} actions={actions} />
          ))}
        </div>
        {part.type === "battery" ? (
          <NumberField
            label="Voltage (V)"
            value={part.volts ?? 0}
            parse={parseVoltage}
            rangeCopy={copy.voltageRange}
            disabled={readOnly}
            onValid={(volts) => actions.onVolts(label, volts)}
            onSeal={actions.onSeal}
          />
        ) : null}
        {part.type === "resistor" ? (
          <NumberField
            label={`Resistance (${OHM})`}
            value={part.ohms ?? 0}
            parse={parseResistance}
            rangeCopy={copy.resistanceRange}
            disabled={readOnly}
            onValid={(ohms) => actions.onOhms(label, ohms)}
            onSeal={actions.onSeal}
          />
        ) : null}
        {part.type === "switch" ? (
          <button
            type="button"
            role="switch"
            className="switch-toggle"
            aria-label={label}
            aria-checked={part.closed === true}
            disabled={readOnly}
            onClick={() => actions.onToggle(label, part.closed !== true)}
          >
            <span className="switch-toggle__track" aria-hidden="true"><span className="switch-toggle__knob" /></span>
            <span aria-hidden="true">{part.closed ? "Closed" : "Open"}</span>
          </button>
        ) : null}
        {part.type === "led" ? (
          <button type="button" className="pill pill--circuit pill--small" disabled={readOnly || part.broken !== true} onClick={() => actions.onReset(label)}>
            <RotateCcw size={18} aria-hidden="true" />
            Reset LED
          </button>
        ) : null}
      </div>
    </div>
  );
}
