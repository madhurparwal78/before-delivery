import { GripVertical, Octagon, X } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import type { ArgSpec, ArgValue } from "../../shared/operations/types";
import { operationDefinition } from "../../shared/operations/catalogue";
import type { ByteRange } from "../../shared/span";
import { useStore } from "../store";
import {
  dragStepTo, dropStep, focusNeighbour, moveStep, removeStep, setArgument, toggleBreakpoint, toggleDisabled,
} from "./actions";
import { workbench } from "./state";
import type { StepItem } from "./state";

const FLAG_BOXES = [["Global (g)", "g"], ["Ignore case (i)", "i"], ["Multiline (m)", "m"], ["Dot matches newline (s)", "s"]] as const;
const TEXT_FIELDS = "INPUT, SELECT, TEXTAREA";

function IntegerField({ arg, value, onValue }: { arg: Extract<ArgSpec, { kind: "integer" }>; value: number; onValue: (value: number) => void }) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? String(value);
  const parsed = /^\d+$/.test(shown) ? Number(shown) : NaN;
  const valid = parsed >= arg.min && parsed <= arg.max;
  return (
    <div className="field">
      <label htmlFor={id}>{arg.label}</label>
      <input
        id={id}
        type="number"
        className="mono"
        min={arg.min}
        max={arg.max}
        step={1}
        value={shown}
        aria-invalid={!valid}
        onChange={(event) => {
          setDraft(event.target.value);
          const next = /^\d+$/.test(event.target.value) ? Number(event.target.value) : NaN;
          if (next >= arg.min && next <= arg.max) onValue(next);
        }}
        onBlur={() => setDraft(null)}
      />
    </div>
  );
}

function ArgumentField({ arg, value, onValue }: { arg: ArgSpec; value: ArgValue; onValue: (value: ArgValue) => void }) {
  const id = useId();
  switch (arg.kind) {
    case "option":
      return (
        <div className="field">
          <label htmlFor={id}>{arg.label}</label>
          <select id={id} value={String(value)} onChange={(event) => onValue(event.target.value)}>
            {arg.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      );
    case "toggle":
      return (
        <div className="field field-toggle">
          <input id={id} type="checkbox" checked={value === true} onChange={(event) => onValue(event.target.checked)} />
          <label htmlFor={id}>{arg.label}</label>
        </div>
      );
    case "integer":
      return <IntegerField arg={arg} value={Number(value)} onValue={onValue} />;
    case "text":
      return (
        <div className="field">
          <label htmlFor={id}>{arg.label}</label>
          <input id={id} type="text" className="mono" spellCheck={false} autoComplete="off" value={String(value)} onChange={(event) => onValue(event.target.value)} />
        </div>
      );
    case "flags":
      return (
        <fieldset className="field flags">
          <legend>{arg.label}</legend>
          {FLAG_BOXES.map(([name, letter]) => (
            <label key={letter} className="flag">
              <input
                type="checkbox"
                checked={String(value).includes(letter)}
                onChange={(event) => {
                  const on = new Set(String(value));
                  if (event.target.checked) on.add(letter);
                  else on.delete(letter);
                  onValue([..."gims"].filter((flag) => on.has(flag)).join(""));
                }}
              />
              <span>{name}</span>
            </label>
          ))}
        </fieldset>
      );
  }
}

export function StepCard({ step, index, chip, current, failed }: {
  step: StepItem; index: number; chip: ByteRange | "lost" | null; current: boolean; failed: boolean;
}) {
  const card = useRef<HTMLLIElement>(null);
  const focus = useStore(workbench, (state) => state.focusStep);
  const number = index + 1;
  const operation = operationDefinition(step.op);

  useLayoutEffect(() => {
    if (focus?.id === step.id) card.current?.focus();
  }, [focus, step.id]);

  const onKeyDown = (event: KeyboardEvent<HTMLLIElement>): void => {
    if ((event.target as HTMLElement).matches(TEXT_FIELDS)) return;
    if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      moveStep(step.id, event.key === "ArrowUp" ? -1 : 1);
    } else if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      focusNeighbour(step.id, event.key === "ArrowUp" ? -1 : 1);
    } else if (event.key === "Delete") {
      event.preventDefault();
      removeStep(step.id);
    } else if (event.key.toLowerCase() === "d") {
      event.preventDefault();
      toggleDisabled(step.id);
    } else if (event.key.toLowerCase() === "b") {
      event.preventDefault();
      toggleBreakpoint(step.id);
    }
  };

  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    const startedAt = workbench.get().steps.findIndex((item) => item.id === step.id);
    let at = startedAt;
    let anchor = event.clientY;
    const heightOf = (position: number): number => {
      const neighbour = workbench.get().steps[position];
      const element = neighbour && document.querySelector(`[data-step-id="${neighbour.id}"]`);
      return element ? element.getBoundingClientRect().height : Infinity;
    };
    const move = (moved: PointerEvent): void => {
      if (moved.pointerId !== event.pointerId) return;
      for (;;) {
        const travelled = moved.clientY - anchor;
        const towards = travelled > 0 ? at + 1 : at - 1;
        const height = heightOf(towards);
        if (Math.abs(travelled) <= height / 2) return;
        dragStepTo(step.id, towards);
        at = towards;
        anchor += travelled > 0 ? height : -height;
      }
    };
    const drop = (ended: PointerEvent): void => {
      if (ended.pointerId !== event.pointerId) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", drop);
      window.removeEventListener("pointercancel", drop);
      dropStep(step.id, startedAt);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", drop);
    window.addEventListener("pointercancel", drop);
  };

  return (
    <li
      ref={card}
      className="step"
      data-step-id={step.id}
      data-disabled={step.disabled}
      data-current={current}
      data-failed={failed}
      tabIndex={0}
      aria-label={`Step ${number}: ${step.op}`}
      aria-current={current ? "step" : undefined}
      onKeyDown={onKeyDown}
    >
      <div className="step-head">
        <button type="button" className="reorder" aria-label={`Reorder step ${number}`} onPointerDown={startDrag}>
          <GripVertical size={18} aria-hidden="true" />
        </button>
        <span className="step-number" aria-hidden="true">{number}</span>
        <span className="step-name">{step.op}</span>
        <div className="step-tools">
          <label className="disable-toggle">
            <input type="checkbox" aria-label={`Disable step ${number}`} checked={step.disabled} onChange={() => toggleDisabled(step.id)} />
            <span aria-hidden="true">Off</span>
          </label>
          <button type="button" className="step-button" aria-label={`Toggle breakpoint on step ${number}`} aria-pressed={step.breakpoint} onClick={() => toggleBreakpoint(step.id)}>
            <Octagon size={16} aria-hidden="true" />
          </button>
          <button type="button" className="step-button" aria-label={`Remove step ${number}`} onClick={() => removeStep(step.id)}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
      {(current || failed || chip) && (
        <div className="step-marks">
          {current && <span className="step-state">Current</span>}
          {failed && <span className="step-state step-error">Error</span>}
          {chip && <span className="chip">{chip === "lost" ? "span lost" : `output ${chip.start}–${chip.end - 1}`}</span>}
        </div>
      )}
      {operation.args.length > 0 && (
        <div className="step-args">
          {operation.args.map((arg) => (
            <ArgumentField key={arg.key} arg={arg} value={step.args[arg.key] as ArgValue} onValue={(value) => setArgument(step.id, arg.key, value)} />
          ))}
        </div>
      )}
    </li>
  );
}
