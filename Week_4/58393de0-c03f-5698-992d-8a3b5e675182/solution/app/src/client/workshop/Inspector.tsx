import { ChevronDown, ChevronUp, CircleAlert } from "lucide-react";
import { useId, useState, type KeyboardEvent } from "react";
import { copy } from "../../shared/copy";
import { DESIGN_OBJECT_MAX } from "../../shared/limits";
import type { DesignObject } from "../../shared/types";
import { useStatus } from "../lib/status";
import { membersOf, parseSize, snapFace, trimmed, type SizeField } from "./model";
import type { WorkshopState, WorkshopStore } from "./store";

const FIELDS: readonly { field: SizeField; label: string }[] = [
  { field: "w", label: "Width (mm)" },
  { field: "d", label: "Depth (mm)" },
  { field: "h", label: "Height (mm)" },
];

/** The size every chosen object shares, as text; empty when they differ or nothing is chosen. */
function sharedSize(chosen: readonly DesignObject[], field: SizeField): string {
  const first = chosen[0];
  if (!first || chosen.some((object) => object[field] !== first[field])) return "";
  return trimmed(first[field], 1);
}

interface SizeFieldProps {
  field: SizeField;
  label: string;
  value: string;
  editable: boolean;
  empty: boolean;
  store: WorkshopStore;
}

/** One size box: applies on Enter or when focus leaves; a bad value keeps the box as typed and explains itself. */
function SizeBox({ field, label, value, editable, empty, store }: SizeFieldProps) {
  const { announce } = useStatus();
  const [draft, setDraft] = useState<string | null>(null);
  const [rejected, setRejected] = useState<string | null>(null);
  const errorId = useId();
  const inputId = useId();

  const commit = () => {
    if (draft === null || draft === rejected) return;
    const size = parseSize(draft);
    if (size === null) {
      setRejected(draft);
      announce(copy.sizeRange);
      return;
    }
    store.setSize(field, size);
    setDraft(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") commit();
    else if (event.key === "Escape") {
      setDraft(null);
      setRejected(null);
    }
  };

  const invalid = draft !== null && draft === rejected;
  return (
    <div className="field">
      <label htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={draft ?? value}
        placeholder={empty ? "" : "Mixed"}
        disabled={empty}
        readOnly={!editable}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={invalid ? errorId : undefined}
        onChange={(event) => { setDraft(event.target.value); setRejected(null); }}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
      {invalid ? (
        <p className="field-error" id={errorId}>
          <CircleAlert size={16} aria-hidden="true" />
          <span>{copy.sizeRange}</span>
        </p>
      ) : null}
    </div>
  );
}

interface InspectorProps {
  state: WorkshopState;
  store: WorkshopStore;
  narrow: boolean;
}

/** Sizes of the selected shapes, plus where the workplane is. On phones it folds away under the canvas. */
export function Inspector({ state, store, narrow }: InspectorProps) {
  const [open, setOpen] = useState(true);
  const bodyId = useId();
  const chosen = membersOf(state.design, state.selected);
  const editable = !store.readOnly && !state.grouping && chosen.some((object) => object.kind !== "group");
  const face = snapFace(state.design.workplane.normal);
  const count = state.design.objects.length;
  const summary = chosen.length === 0 ? "Nothing selected" : `${chosen.length} selected`;
  const selectionKey = state.selected.join(",");
  const showBody = !narrow || open;

  return (
    <section className="workshop-inspector" aria-label="Inspector" tabIndex={0}>
      <div className="inspector-head">
        <p className="eyebrow">3D Workshop</p>
        {narrow ? (
          <button
            type="button"
            className="inspector-toggle"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen(!open)}
          >
            <span>Sizes</span>
            {open ? <ChevronUp size={20} aria-hidden="true" /> : <ChevronDown size={20} aria-hidden="true" />}
          </button>
        ) : (
          <h2>Sizes</h2>
        )}
      </div>
      <div id={bodyId} hidden={!showBody}>
        <p className="inspector-summary">{summary}</p>
        {FIELDS.map(({ field, label }) => (
          <SizeBox
            key={`${field}-${selectionKey}`}
            field={field}
            label={label}
            value={sharedSize(chosen, field)}
            editable={editable}
            empty={chosen.length === 0}
            store={store}
          />
        ))}
        <dl className="inspector-facts">
          <div>
            <dt>Workplane</dt>
            <dd>{face.name} face</dd>
          </div>
          <div>
            <dt>Shapes</dt>
            <dd className="figures">{count} of {DESIGN_OBJECT_MAX}</dd>
          </div>
        </dl>
        <dl className="inspector-keys">
          <div><dt>B C S</dt><dd>Add a box, cylinder or sphere</dd></div>
          <div><dt>Arrows</dt><dd>Move 1 mm (Shift: 10 mm)</dd></div>
          <div><dt>Page Up and Down</dt><dd>Move along the workplane normal</dd></div>
          <div><dt>R</dt><dd>Rotate mode</dd></div>
          <div><dt>H</dt><dd>Solid or hole</dd></div>
          <div><dt>Ctrl+G</dt><dd>Group (Shift: ungroup)</dd></div>
          <div><dt>L, W</dt><dd>Align, workplane</dd></div>
        </dl>
      </div>
    </section>
  );
}
