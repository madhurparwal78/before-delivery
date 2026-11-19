import { useState } from 'react';
import { ApiFailure, type ImportRow, type ImportRun } from '../api.js';
import { call } from '../guard.js';
import { refuse, say } from '../live.js';

const OUTCOME: Record<ImportRow['outcome'], string> = {
  created: 'Filed',
  matched: 'Already on file',
  held: 'Held for your choice',
  rejected: 'Rejected',
};

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function ImportScreen(): React.ReactElement {
  const [run, setRun] = useState<ImportRun | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState(false);

  const upload = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (pending || file === null) return;
    setPending(true);
    setMessage(undefined);
    try {
      // The file's bytes exactly as read from disk, never decoded as text first.
      const bytes = new Uint8Array(await file.arrayBuffer());
      const answer = await call<ImportRun>('/api/imports', {
        method: 'POST',
        body: { filename: file.name, file_base64: toBase64(bytes) },
      });
      setRun(answer);
      say(
        `${answer.counts.created} filed, ${answer.counts.matched} already on file, ${answer.counts.held} held for your choice, ${answer.counts.rejected} rejected.`,
      );
    } catch (error) {
      if (error instanceof ApiFailure) {
        setMessage(error.fields.file_base64 ?? error.fields.filename);
        refuse(error.message);
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <main>
      <h1>Import a spreadsheet</h1>
      <div className="folder">
        <span className="folder-tab" aria-hidden="true">
          Import
        </span>
        <div className="folder-band folder-band--surface">
          <div className="slip">
            <form onSubmit={upload} noValidate>
              <div className="field">
                <label htmlFor="import-file">Spreadsheet file</label>
                <input
                  id="import-file"
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                />
                {message === undefined ? null : <p className="field-message">{message}</p>}
              </div>
              <button type="submit" className="solid">
                {pending ? 'Importing' : 'Import rows'}
              </button>
            </form>
          </div>

          {run === null ? null : (
            <>
              <h2>{run.filename}</h2>
              <table>
                <caption className="hidden-live">Import rows</caption>
                <thead>
                  <tr>
                    <th scope="col">Row</th>
                    <th scope="col">Outcome</th>
                    <th scope="col">Reason</th>
                    <th scope="col">Names</th>
                  </tr>
                </thead>
                <tbody>
                  {run.rows.map((row) => (
                    <tr key={row.row}>
                      <td className="figures">{row.row}</td>
                      <td>{OUTCOME[row.outcome]}</td>
                      <td>{row.reason ?? ''}</td>
                      <td>
                        {row.names.map((name) =>
                          name.held === null ? (
                            <p key={name.text}>{name.text}</p>
                          ) : (
                            <HeldName
                              key={name.text}
                              importId={run.id}
                              row={row.row}
                              name={name}
                              onSaved={(updated) =>
                                setRun((current) =>
                                  current === null
                                    ? current
                                    : {
                                        ...current,
                                        rows: current.rows.map((entry) =>
                                          entry.row === updated.row ? updated : entry,
                                        ),
                                      },
                                )
                              }
                            />
                          ),
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

function HeldName(props: {
  importId: string;
  row: number;
  name: ImportRow['names'][number];
  onSaved: (row: ImportRow) => void;
}): React.ReactElement {
  const [choice, setChoice] = useState(props.name.candidates[0]?.person_id ?? '');
  const [pending, setPending] = useState(false);

  const save = async (): Promise<void> => {
    if (pending) return;
    setPending(true);
    try {
      const row = await call<ImportRow>(`/api/imports/${props.importId}/rows/${props.row}/choice`, {
        method: 'POST',
        body: { text: props.name.text, person_id: choice === '' ? null : choice },
      });
      say('Choice saved.');
      props.onSaved(row);
    } catch (error) {
      if (error instanceof ApiFailure) refuse(error.message);
    } finally {
      setPending(false);
    }
  };

  const id = `held-${props.row}-${props.name.text.replace(/\W+/g, '-')}`;
  return (
    <span className="slip-actions">
      <label htmlFor={id}>{`Who is ${props.name.text}?`}</label>
      <select id={id} value={choice} onChange={(event) => setChoice(event.target.value)}>
        {props.name.candidates.map((candidate) => (
          <option key={candidate.person_id} value={candidate.person_id}>
            {candidate.full_name}
          </option>
        ))}
        <option value="">Not on record</option>
      </select>
      <button type="button" onClick={() => void save()}>
        {pending ? 'Saving' : 'Save choice'}
      </button>
    </span>
  );
}
