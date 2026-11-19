import { useImperativeHandle, useRef, type Ref } from "react";
import { Cable, X } from "lucide-react";
import type { CircuitWire } from "../../shared/types";
import { wireColour } from "./drawing";
import { wireName } from "./model";
import type { PartView } from "./readouts";

export interface WireListHandle {
  /** Moves focus to the delete button at `index` (or the last one), or to the list heading when no wire is left. */
  focusNear: (index: number) => void;
}

interface WireListProps {
  wires: readonly CircuitWire[];
  readOnly: boolean;
  onDelete: (index: number) => void;
  handle: Ref<WireListHandle>;
}

export function WireList({ wires, readOnly, onDelete, handle }: WireListProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  const list = useRef<HTMLUListElement>(null);
  useImperativeHandle(handle, () => ({
    focusNear: (index) => {
      const buttons = list.current?.querySelectorAll<HTMLButtonElement>("button") ?? [];
      (buttons[Math.min(index, buttons.length - 1)] ?? heading.current)?.focus();
    },
  }), []);
  return (
    <div className="bench-panel card">
      <h3 tabIndex={-1} ref={heading}>Wires</h3>
      <ul className="wire-list" aria-label="Wires" ref={list}>
        {wires.map((wire, index) => {
          const name = wireName(wire);
          return (
            <li key={`${wire.from}>${wire.to}`} className="wire-item" aria-label={name}>
              <span className="wire-item__swatch" style={{ background: wireColour(index) }} aria-hidden="true" />
              <span className="wire-item__name">{name}</span>
              <button type="button" className="icon-button" aria-label={`Delete wire ${name}`} disabled={readOnly} onClick={() => onDelete(index)}>
                <X size={20} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
      {wires.length === 0 ? (
        <p className="bench-hint"><Cable size={18} aria-hidden="true" /> Press a terminal, then another, or drag between two terminals.</p>
      ) : null}
    </div>
  );
}

export function Readouts({ views }: { views: readonly PartView[] }) {
  return (
    <section className="bench-panel card" aria-labelledby="bench-readouts-title">
      <h3 id="bench-readouts-title">Readouts</h3>
      {views.length === 0 ? <p className="bench-hint">Readings for every part appear here.</p> : null}
      <ul className="readout-list">
        {views.map((view) => (
          <li key={view.label} className="readout" data-status={view.status}>
            <div className="readout__head">
              <span className="readout__label">{view.label}</span>
              <span className="readout__status">{view.status}</span>
            </div>
            <div className="readout__figures figures">
              <span>{view.currentMa} mA</span>
              <span>{view.volts} V</span>
            </div>
            {view.brightness !== null ? (
              <div className="readout__brightness">
                <span className="readout__bar" aria-hidden="true"><span style={{ width: `${Number(view.brightness) * 100}%` }} /></span>
                <span className="figures">Brightness {view.brightness}</span>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
