// The Placement panel: coordinates, move and rotate controls, the live check, Place, Cancel, Remove.
import { useLayoutEffect, useRef, type KeyboardEvent, type RefObject } from "react";
import type { Refusal } from "../../shared/rules";
import { ArrowIcon, RotateIcon } from "../components/Icons";
import { rise } from "../motion";

interface PanelState {
  number: string;
  placed: boolean;
  gone: boolean;
  refusal: Refusal | null;
  xText: string;
  yText: string;
  rotationText: string;
  coordNote: string;
}

interface Props {
  state: PanelState;
  heading: RefObject<HTMLHeadingElement | null>;
  busy: boolean;
  onMove: (dx: number, dy: number) => void;
  onRotate: () => void;
  onType: (field: "x" | "y" | "rotation", text: string) => void;
  onCommit: (field: "x" | "y" | "rotation") => void;
  onPlace: () => void;
  onCancel: () => void;
  onRemove: () => void;
}

export function PlacementPanel({ state, heading, busy, onMove, onRotate, onType, onCommit, onPlace, onCancel, onRemove }: Props) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    return element ? rise(element) : undefined;
  }, [state.number]);

  const commitOnEnter = (field: "x" | "y" | "rotation") => (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onCommit(field);
    }
  };

  const coordinate = (field: "x" | "y" | "rotation", id: string, label: string, value: string, step: string, max: string) => (
    <div className="field coord">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="input num"
        type="number"
        inputMode="decimal"
        step={step}
        min="0"
        max={max}
        value={value}
        data-coordinate="true"
        onChange={(event) => onType(field, event.target.value)}
        onKeyDown={commitOnEnter(field)}
        onFocus={(event) => event.currentTarget.select()}
        onBlur={() => onCommit(field)}
      />
    </div>
  );

  return (
    <section className="placement-panel stub" aria-label="Placement" ref={ref}>
      <h3 tabIndex={-1} ref={heading} className="panel-heading">
        Placing Piece {state.number}
      </h3>
      {state.gone ? (
        <p className="panel-check is-error">Piece {state.number} was placed elsewhere.</p>
      ) : (
        <p className={`panel-check${state.refusal ? " is-error" : " is-clear"}`}>{state.refusal ? state.refusal.message : "Position clear"}</p>
      )}
      <div className="coords">
        {coordinate("x", "coord-x", "X (in)", state.xText, "0.5", "23")}
        {coordinate("y", "coord-y", "Y (in)", state.yText, "0.5", "23")}
        {coordinate("rotation", "coord-rotation", "Rotation (degrees)", state.rotationText, "90", "270")}
      </div>
      {state.coordNote ? <p className="hint">{state.coordNote}</p> : null}
      <div className="pad" aria-label="Move the footprint" role="group">
        <button type="button" className="btn pad-up" onClick={() => onMove(0, -1)}>
          <ArrowIcon turn={270} />
          Move up
        </button>
        <button type="button" className="btn pad-left" onClick={() => onMove(-1, 0)}>
          <ArrowIcon turn={180} />
          Move left
        </button>
        <button type="button" className="btn pad-rotate" onClick={onRotate}>
          <RotateIcon />
          Rotate
        </button>
        <button type="button" className="btn pad-right" onClick={() => onMove(1, 0)}>
          <ArrowIcon turn={0} />
          Move right
        </button>
        <button type="button" className="btn pad-down" onClick={() => onMove(0, 1)}>
          <ArrowIcon turn={90} />
          Move down
        </button>
      </div>
      <div className="panel-actions">
        <button type="button" className="btn btn-primary" onClick={onPlace} disabled={busy || state.gone}>
          Place
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        {state.placed ? (
          <button type="button" className="btn btn-quiet danger" onClick={onRemove} disabled={busy}>
            Remove from shelf
          </button>
        ) : null}
      </div>
      <p className="hint keys">Arrows move ½ in · R turns 90° · Enter places · Esc puts it back{state.placed ? " · Delete removes" : ""}</p>
    </section>
  );
}
