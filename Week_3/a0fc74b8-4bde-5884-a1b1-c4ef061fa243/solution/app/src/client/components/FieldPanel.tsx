import { X } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { VALIDATION_COPY } from "../../shared/copy";
import { LABEL_LIMIT, codePoints, truncateCodePoints } from "../../shared/limits";
import type { DocumentJson, FieldJson } from "../../shared/types";
import { Slide } from "./Slide";

interface FieldPanelProps {
  open: boolean;
  field: FieldJson | null;
  doc: DocumentJson;
  edge: "right" | "bottom";
  change: (patch: Partial<Pick<FieldJson, "recipientId" | "required" | "label">>) => void;
  close: () => void;
}

export function FieldPanel({ open, field, doc, edge, change, close }: FieldPanelProps) {
  const last = useRef<FieldJson | null>(null);
  if (field) last.current = field;
  const shown = field ?? last.current;
  return (
    <Slide open={open && field !== null} edge={edge}>
      {(ref) =>
        shown ? (
          <aside ref={ref} aria-label="Field properties" className={`panel panel-${edge}`}>
            <PanelBody key={shown.id} field={shown} doc={doc} change={change} close={close} />
          </aside>
        ) : null
      }
    </Slide>
  );
}

function PanelBody({ field, doc, change, close }: Pick<FieldPanelProps, "doc" | "change" | "close"> & { field: FieldJson }) {
  const [label, setLabel] = useState(field.label);
  const input = useRef<HTMLInputElement>(null);
  // While the Label box is being edited it owns the text; a refresh carrying an earlier save never overwrites it.
  useEffect(() => {
    if (document.activeElement !== input.current) setLabel(field.label);
  }, [field.label]);
  const invalid = codePoints(label.trim()) < 1;
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
    }
  };
  return (
    <div onKeyDown={onKeyDown} className="panel-body">
      <div className="panel-head">
        <h2>Field properties</h2>
        <button type="button" className="icon-btn" onClick={close}>
          <X size={18} aria-hidden="true" />
          <span className="sr-only">Close</span>
        </button>
      </div>
      <label className="field-label">
        Assign to
        <select value={field.recipientId} onChange={(e) => change({ recipientId: e.target.value })}>
          {doc.recipients.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      <label className="check">
        <input type="checkbox" checked={field.required} onChange={(e) => change({ required: e.target.checked })} />
        Required
      </label>
      <label className="field-label">
        Label
        <input
          ref={input}
          type="text"
          value={label}
          aria-invalid={invalid}
          onBlur={() => setLabel(field.label)}
          onChange={(e) => {
            const next = truncateCodePoints(e.target.value, LABEL_LIMIT);
            setLabel(next);
            if (codePoints(next.trim()) >= 1) change({ label: next.trim() });
          }}
        />
      </label>
      {invalid ? <p role="alert" className="error">{VALIDATION_COPY.label}</p> : null}
    </div>
  );
}
