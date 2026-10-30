import { useState } from 'react';
import type { ImportReport } from '../../shared/types';
import { ApiError, request } from '../api';
import { useApp } from '../app-state';
import { FieldError } from '../components/Dialog';

export function Import(): JSX.Element {
  const app = useApp();
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<{ report: ImportReport; source: string } | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);

  const run = async (dryRun: boolean): Promise<void> => {
    setError(undefined);
    app.setPending(dryRun ? 'Reading CSV…' : 'Importing…');
    try {
      const report = await request<ImportReport>('/api/imports', {
        method: 'POST',
        body: { csv, dryRun },
      });
      if (dryRun) {
        setPreview({ report, source: csv });
        app.setSaveStatus(
          `Preview ready: ${report.totals.created} created, ${report.totals.matched} matched, ` +
            `${report.totals.skipped} skipped. Nothing has been imported yet.`,
        );
      } else {
        setPreview({ report, source: csv });
        app.setSaveStatus(
          `Imported ${report.totals.notes} notes: ${report.totals.created} created, ` +
            `${report.totals.matched} matched, ${report.totals.skipped} skipped.`,
        );
      }
    } catch (caught) {
      app.setSaveStatus('');
      if (caught instanceof ApiError) {
        setError(caught.fields.csv ?? caught.message);
        app.setAlert(caught.fields.csv ?? caught.message);
      }
    }
  };

  const previewValid = preview !== null && preview.source === csv && preview.report.dryRun;

  return (
    <main className="import">
      <h1 className="display">Import legacy feedback</h1>
      <div className="field">
        <label htmlFor="import-csv">CSV</label>
        <textarea
          id="import-csv"
          aria-label="CSV"
          aria-describedby="import-csv-error"
          rows={12}
          value={csv}
          onChange={(event) => setCsv(event.target.value)}
        />
        <FieldError id="import-csv-error" message={error} />
      </div>
      <div className="row">
        <button type="button" className="button" onClick={() => void run(true)}>
          Preview import
        </button>
        <button
          type="button"
          className="button accent"
          disabled={!previewValid}
          onClick={() => void run(false)}
        >
          Import rows
        </button>
      </div>

      {preview !== null ? (
        <>
          <p className="hint">
            {preview.report.totals.rows} rows · {preview.report.totals.created} created ·{' '}
            {preview.report.totals.matched} matched · {preview.report.totals.skipped} skipped ·{' '}
            {preview.report.totals.companiesCreated} companies created
          </p>
          <table aria-label="Import preview">
            <thead>
              <tr>
                <th scope="col">Line</th>
                <th scope="col">Outcome</th>
                <th scope="col">Reason</th>
              </tr>
            </thead>
            <tbody>
              {preview.report.rows.map((row) => (
                <tr key={row.line}>
                  <td className="figure">{row.line}</td>
                  <td>{row.outcome}</td>
                  <td>{row.reason ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </main>
  );
}
