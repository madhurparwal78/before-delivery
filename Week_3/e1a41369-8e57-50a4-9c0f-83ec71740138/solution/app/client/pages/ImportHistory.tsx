import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import type { ImportRecord } from "../../shared/api";
import { api } from "../api";
import { plural } from "../format";

function resultOf(record: ImportRecord): string {
  return record.status === "imported" ? `Imported ${plural(record.taskCount, "task")}` : `Rejected: ${plural(record.errorCount, "error")}`;
}

export function ImportHistory() {
  const [imports, setImports] = useState<ImportRecord[] | null>(null);
  useEffect(() => {
    void api<{ imports: ImportRecord[] }>("GET", "/api/imports").then((body) => setImports(body.imports));
  }, []);
  return (
    <main className="page">
      <section className="page-head"><h1 className="page-title">Import history</h1></section>
      <div className="page-body">
      {imports && imports.length === 0 && <p>No imports yet.</p>}
      {imports && imports.length > 0 && (
        <ul className="ledger" role="list" aria-label="Import history">
          {imports.map((record) => (
            <li key={record.id}>
              <span className="ledger-name">{record.filename}</span>
              <span className="ledger-result">{resultOf(record)}</span>
              <a className="btn" href={`/api/imports/${record.id}/original`} download={record.filename}>
                <Download aria-hidden="true" size={18} /> Download original
              </a>
            </li>
          ))}
        </ul>
      )}
      </div>
    </main>
  );
}
