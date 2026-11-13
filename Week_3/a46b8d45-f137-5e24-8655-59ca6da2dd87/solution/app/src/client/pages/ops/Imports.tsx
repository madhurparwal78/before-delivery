import { useState } from "preact/hooks";
import { OPS_TEXT } from "../../../shared/copy";
import type { ImportReport } from "../../../shared/types";
import { request } from "../../api";
import { showSuccess, startPending } from "../../messages";
import { refuse } from "../../ops";

export function Imports() {
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState(false);

  const upload = async (): Promise<void> => {
    if (!file) return;
    setBusy(true);
    startPending(OPS_TEXT.working);
    const result = await request<ImportReport>("POST", "/api/ops/imports", file);
    setBusy(false);
    if (!result.data) return refuse(result);
    setReport(result.data);
    showSuccess(OPS_TEXT.imported(result.data.created, result.data.updated, result.data.unchanged, result.data.unmatched.length));
  };

  return (
    <div class="stack">
      <h1 class="plate-title">Supplier parts file</h1>
      <div class="field">
        <label for="supplier-file">Supplier parts file</label>
        <input id="supplier-file" type="file" accept=".csv,text/csv" onChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)} />
        <p class="hint">The first line must be exactly <span class="mono">model_name,booklet_number,part_number,part_name,price_gbp,weight_g,longest_side_mm,status</span>.</p>
      </div>
      <p>
        <button type="button" class="primary" disabled={busy} onClick={() => void upload()}>
          Import file
        </button>
      </p>
      <div class="table-region" role="region" aria-label="Unmatched rows" tabIndex={0}>
        <table aria-label="Unmatched rows">
          <thead>
            <tr>
              <th scope="col">Line</th>
              <th scope="col">Reason</th>
            </tr>
          </thead>
          <tbody>
            {(report?.unmatched ?? []).map((row) => (
              <tr key={row.line}>
                <td class="mono">{row.line}</td>
                <td class="reason">{row.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {report && report.unmatched.length === 0 ? <p class="table-note">Every row matched.</p> : null}
    </div>
  );
}
