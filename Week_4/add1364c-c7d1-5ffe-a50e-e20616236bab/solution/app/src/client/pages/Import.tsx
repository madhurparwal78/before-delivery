import { useRef, useState, type FormEvent } from "react";
import { ApiError, newKey, post } from "../lib/api";
import { useTitle } from "../lib/hooks";
import { useStore } from "../lib/store";
import type { ImportName, ImportResult, ImportRow } from "../lib/types";
import { Field, useFieldErrors, useOnce } from "../ui/Field";

const OUTCOMES: Record<ImportRow["outcome"], string> = {
  created: "Filed",
  matched: "Already on file",
  held: "Held for your choice",
  rejected: "Rejected",
};

function toBase64(bytes: Uint8Array): string {
  let text = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) text += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(text);
}

export function Import() {
  useTitle("Import a spreadsheet");
  const { say, warn, bumpAudit } = useStore();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const { errors, setErrors, formRef } = useFieldErrors();
  const { pending, run } = useOnce();
  const input = useRef<HTMLInputElement>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      if (!file) {
        warn("Check the highlighted fields.");
        setErrors({ file: "Choose a spreadsheet file." });
        return;
      }
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const body = await post<ImportResult>("/api/imports", { filename: file.name, file_base64: toBase64(bytes) }, { key: newKey() });
        setResult(body);
        setErrors({});
        say(`${body.counts.created} filed, ${body.counts.matched} already on file, ${body.counts.held} held for your choice, ${body.counts.rejected} rejected.`);
        bumpAudit();
      } catch (error) {
        if (!(error instanceof ApiError)) return;
        if (error.status === 413) warn("That file is too large to import.");
        else {
          warn("Check the highlighted fields.");
          setErrors({ file: error.fields.file_base64 ?? error.fields.filename ?? error.message });
        }
      }
    });
  };

  const updateRow = (updated: ImportRow) => {
    setResult((current) => {
      if (!current) return current;
      const rows = current.rows.map((r) => (r.row === updated.row ? updated : r));
      const counts = { created: 0, matched: 0, held: 0, rejected: 0 };
      for (const r of rows) counts[r.outcome] += 1;
      return { ...current, rows, counts };
    });
  };

  return (
    <div className="folder-page">
      <section className="folder band-0">
        <header className="folder-title"><h1>Import a spreadsheet</h1></header>
        <form className="slip form-slip import-form" ref={formRef} onSubmit={submit} noValidate>
          <p className="muted">Save the old sheet as UTF-8 CSV. Rejected rows never repeat a password.</p>
          <Field label="Spreadsheet file" error={errors.file}>
            {(p) => <input {...p} ref={input} type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />}
          </Field>
          <button type="submit" className="btn btn-solid btn-cut" aria-disabled={pending || undefined}>{pending ? "Importing" : "Import rows"}</button>
        </form>
        {result ? (
          <section className="import-result" aria-label="Import outcome">
            <h2 className="list-title">{result.filename}</h2>
            <div role="table" aria-label="Import rows" className="grid-table import-table">
              <div role="rowgroup" className="gt-head"><div role="row"><span role="columnheader">Row</span><span role="columnheader">Outcome</span><span role="columnheader">Detail</span></div></div>
              <div role="rowgroup" className="gt-body">
                {result.rows.map((row) => <RowOutcome key={row.row} importId={result.id} row={row} onUpdated={updateRow} />)}
              </div>
            </div>
          </section>
        ) : null}
      </section>
    </div>
  );
}

function RowOutcome({ importId, row, onUpdated }: { importId: string; row: ImportRow; onUpdated: (row: ImportRow) => void }) {
  return (
    <div role="row" className="gt-row">
      <span role="cell" className="fig">{row.row}</span>
      <span role="cell"><strong>{OUTCOMES[row.outcome]}</strong></span>
      <span role="cell" className="import-detail">
        {row.outcome === "rejected" ? row.reason : null}
        {row.outcome === "held" ? row.names.filter((n) => n.held !== null).map((n) => <HeldName key={n.text} importId={importId} row={row.row} name={n} onUpdated={onUpdated} />) : null}
        {row.outcome === "created" || row.outcome === "matched" ? row.names.map((n) => n.text).join("; ") : null}
      </span>
    </div>
  );
}

function HeldName({ importId, row, name, onUpdated }: { importId: string; row: number; name: ImportName; onUpdated: (row: ImportRow) => void }) {
  const { say, warn, bumpAudit } = useStore();
  const [person, setPerson] = useState<string>(name.candidates[0]?.person_id ?? "");
  const { pending, run } = useOnce();
  const save = () => {
    void run(async () => {
      try {
        const updated = await post<ImportRow>(`/api/imports/${importId}/rows/${row}/choice`, { text: name.text, person_id: person === "" ? null : person });
        onUpdated(updated);
        say("Choice saved.");
        bumpAudit();
      } catch (error) {
        if (error instanceof ApiError) warn(error.message);
      }
    });
  };
  const label = `Who is ${name.text}?`;
  return (
    <span className="held-name">
      <label className="held-label">
        <span>{label}</span>
        <select aria-label={label} value={person} onChange={(e) => setPerson(e.target.value)}>
          {name.candidates.map((c) => <option key={c.person_id} value={c.person_id}>{c.full_name}</option>)}
          <option value="">Not on record</option>
        </select>
      </label>
      <button type="button" className="btn btn-quiet" aria-disabled={pending || undefined} onClick={save}>Save choice</button>
    </span>
  );
}
