import { useState } from "react";
import type { Value } from "../../../shared/expression.js";
import type { FieldSpec } from "../../../shared/fields.js";
import { Modal } from "../../lib/dialog.js";
import { Button } from "../../lib/ui.js";
import type { Column } from "./model.js";

function valueOf(spec: FieldSpec, text: string): Value {
  if (spec.kind === "integer" && text.trim() !== "" && !Number.isNaN(Number(text))) return Number(text);
  if (spec.kind === "boolean") return text.trim() === "true";
  return text.trim() === "" ? null : text;
}

/** Bulk update: one field and one value for every selected row. */
export function BulkDialog({ fields, count, onClose, onUpdate }: { fields: FieldSpec[]; count: number; onClose: () => void; onUpdate: (field: string, value: Value) => void }): JSX.Element {
  const [field, setField] = useState("");
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const spec = fields.find((f) => f.name === field);
  return (
    <Modal label="Bulk update" onClose={onClose}>
      <h2 className="dialog-title">Bulk update</h2>
      <p>{count === 1 ? "1 record selected." : `${count} records selected.`}</p>
      <div className="field">
        <label htmlFor="bulk-field">
          <span className="field-label">Field</span>
        </label>
        <select id="bulk-field" value={field} onChange={(event) => setField(event.target.value)}>
          <option value="">Choose a field</option>
          {fields.map((f) => (
            <option key={f.name} value={f.name}>
              {f.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="bulk-value">
          <span className="field-label">Value</span>
        </label>
        <input id="bulk-value" type="text" value={value} onChange={(event) => setValue(event.target.value)} />
      </div>
      {error ? <p className="form-error">{error}</p> : null}
      <div className="row dialog-actions">
        <Button
          onClick={() => {
            if (!spec) {
              setError("Choose a field to update.");
              return;
            }
            onUpdate(spec.name, valueOf(spec, value));
          }}
        >
          Update
        </Button>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Modal>
  );
}

/** Choose columns: which columns the grid shows, and which the export carries. */
export function ColumnsDialog({ columns, chosen, onChange, onClose }: { columns: Column[]; chosen: ReadonlySet<string>; onChange: (next: Set<string>) => void; onClose: () => void }): JSX.Element {
  return (
    <Modal label="Choose columns" onClose={onClose}>
      <h2 className="dialog-title">Choose columns</h2>
      <div className="column-choices">
        {columns.map((column) => (
          <label key={column.key} className="choice">
            <input
              type="checkbox"
              checked={chosen.has(column.key)}
              disabled={column.key === "number"}
              onChange={(event) => {
                const next = new Set(chosen);
                if (event.target.checked) next.add(column.key);
                else next.delete(column.key);
                onChange(next);
              }}
            />
            {column.label}
          </label>
        ))}
      </div>
      <div className="row dialog-actions">
        <Button onClick={onClose}>Close</Button>
      </div>
    </Modal>
  );
}
