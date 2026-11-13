import { useState } from "react";
import type { JSX } from "react";
import { api, ApiFail } from "../lib/api";
import { CHART_KINDS } from "../../common/symbols";
import { fieldErrors, s } from "../../common/copy";

export function NewPatternDialog(props: { onClose: () => void }): JSX.Element {
  const [name, setName] = useState("");
  const [kind, setKind] = useState(CHART_KINDS[0]!.label);
  const [rows, setRows] = useState(24);
  const [columns, setColumns] = useState(24);
  const [castOn, setCastOn] = useState(24);
  const [error, setError] = useState<string | null>(null);
  const [field, setField] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const result = await api<{ id: string }>("/api/patterns", {
        method: "POST",
        body: JSON.stringify({ name, kind, rows, columns, castOn }),
      });
      window.location.href = `/patterns/${result.id}`;
    } catch (failure) {
      if (failure instanceof ApiFail && failure.status === 422) {
        setError(String(failure.payload.message ?? ""));
        setField(String(failure.payload.field ?? ""));
      } else {
        setError(s.pageError);
      }
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" onClick={(event) => { if (event.target === event.currentTarget) props.onClose(); }}>
      <div
        className="dialog"
        role="dialog"
        aria-label="New pattern"
        onKeyDown={(event) => {
          if (event.key === "Escape") props.onClose();
        }}
      >
        <h2>New pattern</h2>
        <div className="field">
          <label htmlFor="pattern-name">Pattern name</label>
          <input
            id="pattern-name"
            value={name}
            aria-label="Pattern name"
            aria-invalid={field === "name" ? "true" : undefined}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div role="radiogroup" aria-label="Chart kind" className="kind-grid">
          {CHART_KINDS.map((entry) => (
            <button
              key={entry.label}
              type="button"
              role="radio"
              aria-checked={kind === entry.label}
              className="kind-card"
              data-checked={kind === entry.label ? "true" : "false"}
              onClick={() => setKind(entry.label)}
            >
              <span className="line-tile">{entry.craft === "knit" ? "K" : "C"}</span>
              <span>{entry.label}</span>
              <span className="arrow" aria-hidden="true">→</span>
            </button>
          ))}
        </div>
        <div className="field">
          <label htmlFor="pattern-rows">Rows</label>
          <input
            id="pattern-rows"
            type="number"
            value={rows}
            aria-label="Rows"
            aria-invalid={field === "rows" ? "true" : undefined}
            onChange={(event) => setRows(Number(event.target.value))}
          />
        </div>
        <div className="field">
          <label htmlFor="pattern-columns">Columns</label>
          <input
            id="pattern-columns"
            type="number"
            value={columns}
            aria-label="Columns"
            aria-invalid={field === "columns" ? "true" : undefined}
            onChange={(event) => setColumns(Number(event.target.value))}
          />
        </div>
        <div className="field">
          <label htmlFor="pattern-cast-on">Cast on</label>
          <input
            id="pattern-cast-on"
            type="number"
            value={castOn}
            aria-label="Cast on"
            aria-invalid={field === "castOn" ? "true" : undefined}
            onChange={(event) => setCastOn(Number(event.target.value))}
          />
        </div>
        {error ? (
          <p className="alert" role="alert" aria-label="Pattern error">
            {error}
          </p>
        ) : null}
        <div className="actions">
          <button type="button" className="button-plain" onClick={props.onClose}>
            Cancel
          </button>
          <button type="button" className="button-primary" aria-busy={busy} disabled={busy} onClick={() => void submit()}>
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

export function RestoreDialog(props: { next: number; from: number; onRestore: () => void; onCancel: () => void }): JSX.Element {
  return (
    <div className="dialog-backdrop" onClick={(event) => { if (event.target === event.currentTarget) props.onCancel(); }}>
      <div className="dialog" role="dialog" aria-label={`Restore version ${props.from}?`} onKeyDown={(event) => { if (event.key === "Escape") props.onCancel(); }}>
        <h2>{`Restore version ${props.from}?`}</h2>
        <p>{`This makes version ${props.next} from version ${props.from}. Nothing is deleted.`}</p>
        <div className="actions">
          <button type="button" className="button-plain" onClick={props.onCancel}>
            Cancel
          </button>
          <button type="button" className="button-primary" onClick={props.onRestore}>
            Restore
          </button>
        </div>
      </div>
    </div>
  );
}
