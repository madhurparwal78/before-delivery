import { useEffect, useRef, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { ApiFailure, Role, apiGet, apiSend, collectionPath } from '../api';
import { CLASH_NOTICE, DOCUMENT_GONE, READ_ONLY_NOTE, saveErrorText } from '../copy';
import { NOT_VALID_JSON } from '../../shared/messages';
import { prettyJson } from '../../shared/json';
import { DocObject, fromJson } from '../../shared/values';
import { Validator } from '../../shared/validator';
import { ConfirmDialog } from './Dialog';

interface DocumentAnswer {
  document: unknown;
  version: number;
}

export interface EditorHandle {
  save: () => void;
}

export function DocumentEditorBody({
  pid,
  cid,
  docId,
  role,
  validator,
  onClose,
  onSaved,
  onInserted,
  onDeleted,
}: {
  pid: string;
  cid: string;
  docId: string | null;
  role: Role;
  validator: Validator | null;
  onClose: () => void;
  onSaved: () => void;
  onInserted: (docId: string) => void;
  onDeleted: () => void;
}): JSX.Element {
  const [text, setText] = useState(docId ? '' : '{}');
  const [version, setVersion] = useState<number | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [clash, setClash] = useState<{ version: number } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(docId !== null);
  const escaped = useRef(false);
  const savedId = useRef<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const readOnly = role === 'reader';

  useEffect(() => {
    if (!docId) {
      setText('{}');
      setVersion(null);
      setLoading(false);
      return;
    }
    let live = true;
    setLoading(true);
    void apiGet<DocumentAnswer>(`${collectionPath(pid, cid)}/documents/${docId}`)
      .then((answer) => {
        if (!live) return;
        setText(prettyJson(fromJson(answer.document) as DocObject));
        setVersion(answer.version);
        if (savedId.current !== docId) setStatus('');
        setError('');
        setClash(null);
        setLoading(false);
      })
      .catch(() => {
        if (!live) return;
        setError(DOCUMENT_GONE);
        setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [pid, cid, docId]);

  const save = async (overwriteVersion?: number): Promise<void> => {
    if (readOnly) {
      setError(READ_ONLY_NOTE);
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      setStatus('');
      setError(NOT_VALID_JSON);
      return;
    }
    setError('');
    setStatus('Saving');
    try {
      if (!docId) {
        const answer = await apiSend<DocumentAnswer & { document: DocObject }>(
          'POST',
          `${collectionPath(pid, cid)}/documents`,
          { document: parsed },
        );
        const insertedId = String((answer.document as Record<string, unknown>)['_id']);
        savedId.current = insertedId;
        setStatus('Saved');
        setVersion(answer.version);
        setClash(null);
        onInserted(insertedId);
        return;
      }
      const answer = await apiSend<DocumentAnswer>('PUT', `${collectionPath(pid, cid)}/documents/${docId}`, {
        document: parsed,
        version: overwriteVersion ?? version,
      });
      savedId.current = docId;
      setStatus('Saved');
      setVersion(answer.version);
      setClash(null);
      onSaved();
    } catch (failure) {
      setStatus('');
      if (failure instanceof ApiFailure) {
        if (failure.code === 'version_conflict') {
          setClash({ version: Number(failure.body['current_version']) });
          return;
        }
        setError(saveErrorText(failure, validator));
        return;
      }
      setError('That did not work');
    }
  };

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void save();
      return;
    }
    if (event.key === 'Escape') {
      escaped.current = true;
      return;
    }
    if (event.key === 'Tab') {
      if (escaped.current || event.target !== area.current) {
        escaped.current = false;
        return;
      }
      event.preventDefault();
      const element = area.current;
      if (!element) return;
      const start = element.selectionStart;
      const end = element.selectionEnd;
      const next = `${text.slice(0, start)}  ${text.slice(end)}`;
      setText(next);
      requestAnimationFrame(() => {
        element.selectionStart = start + 2;
        element.selectionEnd = start + 2;
      });
      return;
    }
    escaped.current = false;
  };

  const reload = async (): Promise<void> => {
    if (!docId) return;
    const answer = await apiGet<DocumentAnswer>(`${collectionPath(pid, cid)}/documents/${docId}`);
    setText(prettyJson(fromJson(answer.document) as DocObject));
    setVersion(answer.version);
    setClash(null);
    setStatus('');
  };

  return (
    <div onKeyDown={onKeyDown} className="stack" aria-busy={loading ? 'true' : undefined}>
      <h3>{docId ? 'Document' : 'New document'}</h3>
      <label htmlFor="document-json">Document JSON</label>
      <textarea
        id="document-json"
        className="code"
        aria-label="Document JSON"
        value={text}
        readOnly={readOnly}
        spellCheck={false}
        ref={area}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="dialog-actions">
        {readOnly ? null : (
          <button type="button" onClick={() => void save()}>
            Save
          </button>
        )}
        <button type="button" onClick={onClose}>
          Close
        </button>
        {readOnly || !docId ? null : (
          <button type="button" onClick={() => setConfirming(true)}>
            Delete document
          </button>
        )}
      </div>
      <div role="status" aria-label="Save status">
        {error ? (
          <span className="chip">
            <TriangleAlert aria-hidden="true" size={16} />
            {error}
          </span>
        ) : (
          status
        )}
      </div>
      {clash ? (
        <div role="alert" className="alert">
          <span>{CLASH_NOTICE}</span>
          <div className="dialog-actions">
            <button type="button" onClick={() => void reload()}>
              Reload
            </button>
            <button type="button" onClick={() => void save(clash.version)}>
              Overwrite
            </button>
          </div>
        </div>
      ) : null}
      {confirming ? (
        <ConfirmDialog
          label="Delete this document?"
          confirmLabel="Delete"
          onCancel={() => setConfirming(false)}
          onConfirm={async () => {
            if (!docId) return;
            try {
              await apiSend('DELETE', `${collectionPath(pid, cid)}/documents/${docId}`);
              setConfirming(false);
              onDeleted();
            } catch (failure) {
              setConfirming(false);
              if (failure instanceof ApiFailure) setError(saveErrorText(failure, validator));
            }
          }}
        />
      ) : null}
    </div>
  );
}
