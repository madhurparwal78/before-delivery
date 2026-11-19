import { useCallback, useEffect, useRef, useState } from "react";
import { ApiFailure, call, get, type Farm, type ImportRecord } from "../api";
import { plural, utcStamp } from "../format";
import { useLive } from "../shell";

interface Reply { import: ImportRecord; replayed: boolean }

export function ImportsPage() {
  const [farms, setFarms] = useState<Farm[]>([]);
  const [farmId, setFarmId] = useState("");
  const [imports, setImports] = useState<ImportRecord[] | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState("");
  const [summary, setSummary] = useState<ImportRecord | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const listSeq = useRef(0);
  const pressSeq = useRef(0);
  const farmRef = useRef("");
  const alive = useRef(true);
  farmRef.current = farmId;

  useEffect(() => {
    alive.current = true;
    get<{ farms: Farm[] }>("/api/farms", { silent: true }).then((r) => {
      if (!alive.current) return;
      setFarms(r.farms);
      setFarmId((cur) => cur || r.farms[0]?.id || "");
    }, () => undefined);
    return () => { alive.current = false; };
  }, []);

  const load = useCallback(async (id: string) => {
    const mine = ++listSeq.current;
    try {
      const reply = await get<{ imports: ImportRecord[] }>(`/api/farms/${id}/imports`, { silent: true });
      if (alive.current && mine === listSeq.current) setImports(reply.imports);
    } catch { /* the next event loads again */ }
  }, []);

  useEffect(() => {
    if (!farmId) return;
    setImports(null);
    setSummary(null);
    void load(farmId);
  }, [farmId, load]);

  useLive((event) => {
    if (event.type === "resync" || (event.type === "import.created" && event.farm_id === farmRef.current)) void load(farmRef.current);
  });

  const press = async () => {
    if (!file) { setStatus("Choose a legacy CSV file first"); return; }
    const mine = ++pressSeq.current;
    const farm = farmId;
    setStatus("Importing…");
    try {
      const bytes = await file.arrayBuffer();
      const reply = await call<Reply>("POST", `/api/farms/${farm}/imports`, undefined, { raw: bytes, headers: { "Content-Type": "text/csv", "X-Filename": file.name } });
      if (!alive.current || mine !== pressSeq.current) return;
      const record = reply.import;
      if (farmRef.current === farm) setSummary(record);
      setStatus(reply.replayed
        ? "Already imported — nothing new created"
        : `Imported ${record.file_name}: ${record.created.length} created, ${record.merged.length} merged, ${record.already_imported.length} already imported, ${record.orphans.length} ${plural(record.orphans.length, "orphan", "orphans")}, ${record.invalid.length} invalid`);
      void load(farm);
    } catch (error) {
      if (!alive.current || mine !== pressSeq.current) return;
      if (error instanceof ApiFailure) setStatus(error.status === 413 ? "Import file is larger than 2,000,000 bytes" : error.fields?.file ?? error.message);
      else setStatus("");
    }
  };

  const shown = summary ?? imports?.[0] ?? null;
  return (
    <div className="imports-page">
      <h1>Imports</h1>
      <div className="import-controls">
        <label className="field"><span>Farm</span>
          <select aria-label="Farm" value={farmId} onChange={(e) => setFarmId(e.target.value)}>
            {farms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </label>
        <div className="import-file">
          <button type="button" className="btn" onClick={() => input.current?.click()}>Choose legacy CSV</button>
          <input ref={input} type="file" accept=".csv,text/csv" hidden tabIndex={-1} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <span className="muted">{file ? file.name : "No file chosen"}</span>
        </div>
        <button type="button" className="btn btn-solid" onClick={() => void press()}>Import</button>
      </div>
      <p role="status" aria-label="Import status" className="import-status">{status}</p>
      {shown && (
        <div className="summary-tables">
          <Table name="Created" head={["Row", "Defect"]} rows={shown.created.map((r) => [r.row, r.defect_id])} />
          <Table name="Merged" head={["Row", "Defect"]} rows={shown.merged.map((r) => [r.row, r.defect_id])} />
          <Table name="Already imported" head={["Row", "Defect"]} rows={shown.already_imported.map((r) => [r.row, r.defect_id])} />
          <Table name="Orphans" head={["Row", "Site code", "Pen number"]} rows={shown.orphans.map((r) => [r.row, r.site_code, r.pen_no])} />
          <Table name="Invalid" head={["Row", "Reason"]} rows={shown.invalid.map((r) => [r.row, r.reason])} />
        </div>
      )}
      <h2>Past imports</h2>
      {!imports ? <div className="skeleton rows-skeleton" aria-hidden="true" /> : imports.length === 0 ? (
        <h2 className="statement">No imports yet</h2>
      ) : (
        <ul role="list" className="plain past-imports">
          {imports.map((i) => (
            <li key={i.id}>
              <a href={`/api/imports/${i.id}/raw`} download={i.file_name} aria-label={`Download original ${i.file_name}`}>{i.file_name}</a>
              <span className="muted num"> · {utcStamp(i.imported_at)} · {i.rows} rows</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Table({ name, head, rows }: { name: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="table-wrap">
      <h3>{name}</h3>
      <table aria-label={name} className="num">
        <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((cells, i) => <tr key={i}>{cells.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
