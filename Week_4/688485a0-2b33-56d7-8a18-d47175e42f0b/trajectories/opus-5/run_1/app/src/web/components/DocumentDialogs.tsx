import { useRef, useState } from 'react';
import { ApiFailure, apiSend, apiUpload, collectionPath } from '../api';
import { NAME_TAKEN_QUERY, importedText, lineErrorText, tooManyLinesText } from '../copy';
import { Dialog } from './Dialog';

type FileFormat = 'jsonl' | 'csv';

function FormatRadios({
  format,
  onChange,
}: {
  format: FileFormat;
  onChange: (format: FileFormat) => void;
}): JSX.Element {
  const options: Array<{ value: FileFormat; label: string }> = [
    { value: 'jsonl', label: 'JSON lines' },
    { value: 'csv', label: 'CSV' },
  ];
  const move = (step: number): void => {
    const index = options.findIndex((option) => option.value === format);
    onChange(options[(index + step + options.length) % options.length].value);
  };
  return (
    <div className="radio-group" role="radiogroup" aria-label="Format">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={format === option.value}
          tabIndex={format === option.value ? 0 : -1}
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
              event.preventDefault();
              move(1);
            } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
              event.preventDefault();
              move(-1);
            }
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function LoadFileDialog({
  pid,
  cid,
  onClose,
  onLoaded,
  onStorageDown,
}: {
  pid: string;
  cid: string;
  onClose: () => void;
  onLoaded: () => void;
  onStorageDown: () => void;
}): JSX.Element {
  const [format, setFormat] = useState<FileFormat>('jsonl');
  const [fileName, setFileName] = useState('');
  const [bytes, setBytes] = useState<ArrayBuffer | null>(null);
  const [status, setStatus] = useState('');
  const [errors, setErrors] = useState<Array<{ line: number; message: string }>>([]);
  const [importId, setImportId] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = async (): Promise<void> => {
    if (!bytes) return;
    setStatus('Loading file');
    setErrors([]);
    try {
      const answer = await apiUpload<{ import_id: string; inserted: number }>(
        `${collectionPath(pid, cid)}/imports?format=${format}`,
        fileName,
        bytes,
      );
      setImportId(answer.import_id);
      setStatus(importedText(answer.inserted));
      onLoaded();
    } catch (failure) {
      if (!(failure instanceof ApiFailure)) {
        setStatus('');
        return;
      }
      if (failure.code === 'import_failed') {
        setImportId(String(failure.body['import_id']));
        setErrors(failure.body['errors'] as Array<{ line: number; message: string }>);
        setStatus('Import failed');
        return;
      }
      if (failure.code === 'too_many_lines') {
        setStatus(tooManyLinesText(Number(failure.body['limit'])));
        return;
      }
      if (failure.code === 'storage_unavailable') {
        setStatus('');
        onStorageDown();
        return;
      }
      setStatus('');
    }
  };

  return (
    <Dialog label="Load file" onClose={onClose}>
      <h3>Load file</h3>
      <input
        ref={input}
        type="file"
        className="visually-hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={async (event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          setFileName(file.name);
          setBytes(await file.arrayBuffer());
        }}
      />
      <button type="button" onClick={() => input.current?.click()}>
        Choose file
      </button>
      <span className="secondary">{fileName}</span>
      <FormatRadios format={format} onChange={setFormat} />
      <div className="dialog-actions">
        <button type="button" onClick={() => void load()}>
          Load
        </button>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
      <div role="status" aria-label="Import status">
        {status}
      </div>
      <ul className="row-list" aria-label="Line errors">
        {errors.map((entry) => (
          <li key={`${entry.line}-${entry.message}`}>{lineErrorText(entry.line, entry.message)}</li>
        ))}
      </ul>
      {importId ? (
        <a href={`${collectionPath(pid, cid)}/imports/${importId}/original`} download>
          Download original file
        </a>
      ) : null}
    </Dialog>
  );
}

export function DownloadDialog({
  pid,
  cid,
  filter,
  sort,
  onClose,
  onStorageDown,
}: {
  pid: string;
  cid: string;
  filter: unknown;
  sort: unknown;
  onClose: () => void;
  onStorageDown: () => void;
}): JSX.Element {
  const [format, setFormat] = useState<FileFormat>('jsonl');
  const [status, setStatus] = useState('');

  const download = async (): Promise<void> => {
    try {
      const answer = await apiSend<{ export_id: string; download_url: string }>(
        'POST',
        `${collectionPath(pid, cid)}/exports`,
        { format, filter, sort },
      );
      const anchor = document.createElement('a');
      anchor.href = answer.download_url;
      anchor.download = '';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setStatus('Ready');
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.code === 'storage_unavailable') {
        onStorageDown();
        setStatus('');
        return;
      }
      setStatus('');
    }
  };

  return (
    <Dialog label="Download" onClose={onClose}>
      <h3>Download</h3>
      <FormatRadios format={format} onChange={setFormat} />
      <div className="dialog-actions">
        <button type="button" onClick={() => void download()}>
          Download file
        </button>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
      <div role="status">{status}</div>
    </Dialog>
  );
}

export function SaveQueryDialog({
  pid,
  cid,
  filter,
  projection,
  sort,
  limit,
  onClose,
  onSaved,
}: {
  pid: string;
  cid: string;
  filter: unknown;
  projection: unknown;
  sort: unknown;
  limit: number;
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const [name, setName] = useState('');
  const [status, setStatus] = useState('');

  const keep = async (): Promise<void> => {
    try {
      await apiSend('POST', `${collectionPath(pid, cid)}/saved-queries`, { name, filter, projection, sort, limit });
      onSaved();
      onClose();
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.code === 'name_taken') {
        setStatus(NAME_TAKEN_QUERY);
        return;
      }
      setStatus('That did not work');
    }
  };

  return (
    <Dialog label="Save query" onClose={onClose}>
      <h3>Save query</h3>
      <div className="field">
        <label htmlFor="query-name">Query name</label>
        <input id="query-name" type="text" value={name} onChange={(event) => setName(event.target.value)} />
      </div>
      <div className="dialog-actions">
        <button type="button" onClick={() => void keep()}>
          Keep query
        </button>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
      <div role="status">{status}</div>
    </Dialog>
  );
}
