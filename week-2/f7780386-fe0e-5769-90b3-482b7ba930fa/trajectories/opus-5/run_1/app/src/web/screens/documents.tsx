import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';

import type { DocumentRecord, User } from '../../shared/api.js';
import { api } from '../api.js';
import { useAction, useApp } from '../app-state.js';

const STATUS_WORDS: Record<DocumentRecord['status'], string> = {
  uploaded: 'Waiting for review',
  approved: 'Approved',
  rejected: 'Rejected',
  expired: 'Expired',
};

const UPLOAD_PROBLEMS: Record<string, string> = {
  unsupported_file_type: 'Only PDF, PNG or JPEG files are accepted.',
  file_too_large: 'Files must be 5,000,000 bytes or smaller.',
  storage_unavailable: 'File storage is unreachable. Nothing was saved; try again shortly.',
};

const FIELD_PROBLEMS: Record<string, string> = {
  empty: 'That file is empty.',
  invalid_filename: "Rename the file: its name can't contain slashes or two dots in a row.",
};

export function DocumentsScreen(): ReactNode {
  const app = useApp();
  const act = useAction();
  const user = app.user as User;
  const isCrew = user.role === 'crew_cook';

  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [crew, setCrew] = useState<Array<{ id: string; name: string }>>([]);
  const [kind, setKind] = useState(isCrew ? 'food_handler_card' : 'liability_insurance');
  const [crewCookId, setCrewCookId] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    const result = await api<{ documents: DocumentRecord[] }>('/api/documents');
    setDocuments(result.documents);
    const cooks = new Map<string, string>();
    for (const document of result.documents) {
      if (document.crew_cook_id !== null && document.crew_cook_name !== null) {
        cooks.set(document.crew_cook_id, document.crew_cook_name);
      }
    }
    if (isCrew) cooks.set(user.id, user.name);
    setCrew([...cooks].map(([id, name]) => ({ id, name })));
  }, [isCrew, user]);

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const file = fileRef.current?.files?.[0];
    const form = new FormData();
    form.set('kind', kind);
    form.set('expires_on', expiresOn);
    if (kind === 'food_handler_card') {
      form.set('crew_cook_id', isCrew ? user.id : crewCookId);
    }
    if (file !== undefined) form.set('file', file);

    setBusy(true);
    await act(
      'Uploading…',
      async () => {
        await api('/api/documents', { method: 'POST', form });
        if (fileRef.current !== null) fileRef.current.value = '';
        setExpiresOn('');
        await refresh();
        return 'Document uploaded and waiting for review.';
      },
      (error) => {
        const direct = UPLOAD_PROBLEMS[error.code];
        if (direct !== undefined) return direct;
        for (const code of Object.values(error.fields)) {
          const copy = FIELD_PROBLEMS[code];
          if (copy !== undefined) return copy;
        }
        return 'Only PDF, PNG or JPEG files are accepted.';
      },
    );
    setBusy(false);
  };

  return (
    <>
      <h1>Documents</h1>

      <form className="section" aria-label="Upload document" onSubmit={(event) => void submit(event)}>
        <div className="inline-form">
          <span>
            <label htmlFor="doc-kind">Document type</label>
            <select
              id="doc-kind"
              value={kind}
              onChange={(event) => setKind(event.target.value)}
              disabled={isCrew}
            >
              <option value="liability_insurance">Liability insurance</option>
              <option value="food_handler_card">Food handler card</option>
            </select>
          </span>
          <span>
            <label htmlFor="doc-cook">Crew cook</label>
            <select
              id="doc-cook"
              value={isCrew ? user.id : crewCookId}
              onChange={(event) => setCrewCookId(event.target.value)}
              disabled={isCrew || kind !== 'food_handler_card'}
            >
              <option value="">—</option>
              {crew.map((cook) => (
                <option key={cook.id} value={cook.id}>
                  {cook.name}
                </option>
              ))}
            </select>
          </span>
          <span>
            <label htmlFor="doc-expires">Expires on</label>
            <input
              id="doc-expires"
              type="text"
              placeholder="YYYY-MM-DD"
              value={expiresOn}
              onChange={(event) => setExpiresOn(event.target.value)}
            />
          </span>
          <span>
            <label htmlFor="doc-file">File</label>
            <input id="doc-file" type="file" ref={fileRef} />
          </span>
          <button type="submit" className="primary" disabled={busy} aria-busy={busy}>
            Upload document
          </button>
        </div>
        <p className="hint">PDF, PNG or JPEG, up to 5,000,000 bytes</p>
      </form>

      <table>
        <caption>Documents on file</caption>
        <thead>
          <tr>
            <th scope="col">Type</th>
            <th scope="col">Person</th>
            <th scope="col">Expires on</th>
            <th scope="col">Status</th>
            <th scope="col">File</th>
          </tr>
        </thead>
        <tbody>
          {documents.map((document) => (
            <tr key={document.id}>
              <td data-label="Type">
                {document.kind === 'liability_insurance'
                  ? 'Liability insurance'
                  : 'Food handler card'}
              </td>
              <td data-label="Person">{document.crew_cook_name ?? '—'}</td>
              <td data-label="Expires on" className="num">
                {document.expires_on}
              </td>
              <td data-label="Status">{STATUS_WORDS[document.status]}</td>
              <td data-label="File">
                <a href={`/api/documents/${document.id}/file`}>Download</a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
