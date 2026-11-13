import { useEffect, useState } from 'react';
import { api, type ImportRecord } from './api.js';
import { ImportDialog } from './dialogs.js';

/** Import history (DP-45). */
export function ImportsPage() {
  const [imports, setImports] = useState<ImportRecord[]>([]);
  const [dialog, setDialog] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const res = await api.imports();
      setImports(res.imports);
    } catch {
      setError('Something went wrong. Try again.');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <section className="imports-page">
      <h1 className="page-title">Import history</h1>
      {error && <div className="alert-strip" role="alert">{error}</div>}
      {imports.length === 0 ? (
        <p className="empty-sentence">No imports yet.</p>
      ) : (
        <ul className="import-history" aria-label="Import history">
          {imports.map((imp) => (
            <li key={imp.id} className="import-row">
              <span className="import-name">{imp.filename}</span>
              <span className="import-result">
                {imp.status === 'imported'
                  ? `Imported ${imp.taskCount} ${imp.taskCount === 1 ? 'task' : 'tasks'}`
                  : `Rejected: ${imp.errorCount} ${imp.errorCount === 1 ? 'error' : 'errors'}`}
              </span>
              <a className="import-download" href={`/api/imports/${imp.id}/original`}>Download original</a>
            </li>
          ))}
        </ul>
      )}
      <button className="btn btn-primary" type="button" onClick={() => setDialog(true)}>Import tasks</button>
      {dialog && (
        <ImportDialog
          onClose={() => {
            setDialog(false);
            void load();
          }}
        />
      )}
    </section>
  );
}
