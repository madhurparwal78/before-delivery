import { useEffect, useState } from 'react';
import type { ImportRecord } from '../../shared/types.js';
import { api } from '../api.js';
import { importedText, rejectedText } from '../components/ImportDialog.js';

export function Imports(): JSX.Element {
  const [records, setRecords] = useState<ImportRecord[]>([]);

  useEffect(() => {
    void api.imports().then((answer) => setRecords(answer.imports));
  }, []);

  return (
    <main className="imports-page">
      <h1 className="page-title">Import history</h1>
      {records.length === 0 ? (
        <p className="empty-line">No imports yet.</p>
      ) : (
        <ul className="history-list" role="list" aria-label="Import history">
          {records.map((record) => (
            <li key={record.id}>
              <span className="history-name">{record.filename}</span>
              <span className="history-result">
                {record.status === 'imported' ? importedText(record.taskCount) : rejectedText(record.errorCount)}
              </span>
              <a href={`/api/imports/${record.id}/original`} download>
                Download original
              </a>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
