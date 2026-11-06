import { useId, useState } from "react";
import type { ImportReport } from "../../shared/api.js";
import { api, isFailure } from "../api.js";
import { useFeedback } from "../feedback.js";

const REASONS: Record<string, string> = {
  missing_email: "No email", invalid_email: "Email is not valid", missing_feedback: "No feedback",
  invalid_date: "Date is not a real YYYY-MM-DD date", duplicate: "Already imported for this contact",
};
const OUTCOMES: Record<string, string> = { created: "Created", matched: "Matched", skipped: "Skipped" };

export function ImportPage() {
  const feedback = useFeedback();
  const id = useId();
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<{ text: string; report: ImportReport } | null>(null);
  const [busy, setBusy] = useState<"preview" | "import" | null>(null);
  const [fieldError, setFieldError] = useState("");

  const run = async (dryRun: boolean): Promise<void> => {
    setBusy(dryRun ? "preview" : "import");
    setFieldError("");
    feedback.clearAlert();
    if (dryRun) feedback.say("save", "Reading CSV…");
    else feedback.say("save", "Importing…");
    try {
      const report = await api.post<ImportReport>("/api/imports", { csv, dryRun });
      const t = report.totals;
      if (dryRun) {
        setPreview({ text: csv, report });
        feedback.say("save", `Preview ready: ${t.created} created, ${t.matched} matched, ${t.skipped} skipped. Nothing has been imported yet.`);
      } else {
        setPreview({ text: "", report });
        feedback.say("save", `Imported ${t.notes} notes: ${t.created} created, ${t.matched} matched, ${t.skipped} skipped.`);
      }
    } catch (error) {
      setPreview(null);
      feedback.say("save", "");
      if (isFailure(error, 422)) {
        const message = error.fields.csv ?? error.message;
        setFieldError(message);
        feedback.warn(message);
      } else feedback.fail(error);
    } finally {
      setBusy(null);
    }
  };

  const ready = preview !== null && preview.text === csv && preview.report.dryRun;
  const report = preview?.report;
  return (
    <div className="page-body import-page">
      <header className="page-head"><h1>Import legacy feedback</h1></header>
      <p className="lede">Paste a CSV with the columns <code>contact_email, contact_name, company_name, feedback, received_on</code>. Preview first: nothing is written until you import.</p>
      <div className="field">
        <label htmlFor={`${id}-csv`}>CSV</label>
        <textarea id={`${id}-csv`} className="csv-box" rows={10} spellCheck={false} value={csv} onChange={(e) => setCsv(e.target.value)}
          aria-describedby={fieldError ? `${id}-error` : undefined} />
        {fieldError && <p id={`${id}-error`} className="field-error">{fieldError}</p>}
      </div>
      <div className="form-actions">
        <button type="button" className="button-quiet" aria-busy={busy === "preview"} disabled={busy !== null} onClick={() => void run(true)}>Preview import</button>
        <button type="button" className="button" aria-busy={busy === "import"} disabled={!ready || busy !== null} onClick={() => void run(false)}>Import rows</button>
      </div>
      {report && (
        <section className="panel">
          <h2>{report.dryRun ? "Preview" : "Imported"}</h2>
          <dl className="figures">
            {(["rows", "created", "matched", "skipped", "notes", "companiesCreated"] as const).map((k) => (
              <div key={k}><dt>{k === "companiesCreated" ? "New companies" : k[0]?.toUpperCase() + k.slice(1)}</dt><dd className="num">{report.totals[k]}</dd></div>
            ))}
          </dl>
          <table aria-label="Import preview" className="table">
            <thead><tr><th scope="col" className="cell-num">Line</th><th scope="col">Outcome</th><th scope="col">Reason</th></tr></thead>
            <tbody>
              {report.rows.map((r) => (
                <tr key={r.line}>
                  <td className="cell-num num">{r.line}</td>
                  <td><span className={`badge badge-${r.outcome}`}>{OUTCOMES[r.outcome]}</span></td>
                  <td>{r.reason ? REASONS[r.reason] : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
