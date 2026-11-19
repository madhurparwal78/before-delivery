import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api, ApiError, generalErrorCopy } from '../../api/client.ts';
import type { LineError, PreviewResponse } from '../../api/types.ts';
import { act, commit } from '../../api/use-load.ts';
import { formatCount } from '../../../shared/display.ts';
import type { Source } from '../../../shared/model.ts';
import { Button } from '../../ui/button.tsx';
import { Status } from '../../ui/live.tsx';
import { TableWrap } from '../../ui/table-wrap.tsx';
import './data-pages.css';

const UPLOADING = 'Uploading...';
const OUTAGE = 'Storage is unavailable. Your file was not saved. Try again.';

type Tone = 'idle' | 'busy' | 'done' | 'error' | 'outage';

interface UploadState {
  text: string;
  tone: Tone;
}

const IDLE: UploadState = { text: '', tone: 'idle' };

interface ChosenFile {
  name: string;
  bytes: Uint8Array<ArrayBuffer>;
}

/** The copy for a failure that has no list of its own: the general answers, then the two page headlines. */
function failureCopy(error: ApiError): string {
  return generalErrorCopy(error) ?? (error.status === 403 ? 'You do not have access to this.' : 'Not found.');
}

interface Props {
  /** `POST` target of the preview, which stores nothing */
  previewPath: string;
  /** The name of the table being uploaded, as the form holds it. */
  tableName: string;
  /** Sends the file with the form's names. */
  send: (bytes: Uint8Array<ArrayBuffer>) => Promise<Source>;
  /** Called after the server accepted the file, before the success text shows. */
  onUploaded?: (source: Source) => Promise<void>;
  /** The names the server refused, keyed by field; empty when an attempt starts. */
  onNameErrors: (errors: Record<string, string>) => void;
  /** What follows the success text. */
  done?: (source: Source) => ReactNode;
}

/**
 * The file part of the upload page and of `dialog "Add table"`: Choose file, the preview of the first rows with their
 * inferred types, Upload, Try again after a storage outage, the upload errors and `status "Upload state"`.
 */
export function CsvUpload({ previewPath, tableName, send, onUploaded, onNameErrors, done }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const newest = useRef(0);
  const [file, setFile] = useState<ChosenFile | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [errors, setErrors] = useState<LineError[]>([]);
  const [state, setState] = useState<UploadState>(IDLE);
  const [finished, setFinished] = useState<Source | null>(null);
  const [retrying, setRetrying] = useState(false);

  const choose = (chosen: File) => {
    const mine = ++newest.current;
    return act(
      async () => {
        const bytes = new Uint8Array(await chosen.arrayBuffer());
        commit(() => {
          setFile({ name: chosen.name, bytes });
          setPreview(null);
          setErrors([]);
          setState(IDLE);
          setFinished(null);
          setRetrying(false);
        });
        const result = await api.csv<PreviewResponse>('POST', previewPath, bytes);
        if (mine === newest.current) {
          commit(() => {
            setPreview(result);
            setErrors(result.errors);
          });
        }
      },
      (caught) => {
        if (mine !== newest.current) return;
        setPreview(null);
        setErrors(caught.lines);
        if (caught.lines.length === 0) setState({ text: failureCopy(caught), tone: 'error' });
      },
    );
  };

  const upload = (bytes: Uint8Array<ArrayBuffer>) =>
    act(
      async () => {
        commit(() => {
          setErrors([]);
          setFinished(null);
          setState({ text: UPLOADING, tone: 'busy' });
          onNameErrors({});
        });
        const source = await send(bytes);
        await onUploaded?.(source);
        const stored = source.tables.find((table) => table.name === tableName.trim()) ?? source.tables[source.tables.length - 1];
        commit(() => {
          setRetrying(false);
          setState({ text: `Uploaded ${stored?.name ?? tableName}: ${formatCount(stored?.rows ?? 0)} rows.`, tone: 'done' });
          setFinished(source);
        });
      },
      (caught) => {
        setRetrying(caught.status === 503);
        if (caught.status === 503) {
          setState({ text: OUTAGE, tone: 'outage' });
        } else if (caught.lines.length > 0) {
          setErrors(caught.lines);
          setState(IDLE);
        } else if (Object.keys(caught.fields).length > 0) {
          onNameErrors(caught.fields);
          setState({ text: caught.fieldMessage() ?? '', tone: 'error' });
        } else {
          setState({ text: failureCopy(caught), tone: 'error' });
        }
      },
    );

  const busy = state.tone === 'busy';
  // The button stays enabled while busy, so focus stays inside a dialog and Escape still closes it.
  const sendNow = () => (busy ? Promise.resolve() : upload(file?.bytes ?? new Uint8Array(new ArrayBuffer(0))));

  return (
    <div className="csv-upload">
      <div className="form-actions">
        <Button
          onClick={() => {
            input.current?.click();
          }}
        >
          Choose file
        </Button>
        <span className="muted">{file ? file.name : 'No file chosen.'}</span>
        <input
          ref={input}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            event.target.value = '';
            if (chosen) void choose(chosen);
          }}
        />
      </div>
      {preview && preview.columns.length > 0 ? (
        <div className="preview">
          <TableWrap>
            <table aria-label="Preview">
              <thead>
                <tr>
                  {preview.columns.map((column, index) => (
                    <th
                      key={index}
                      scope="col"
                      className={column.type === 'number' ? 'num' : undefined}
                      data-type={column.type}
                      aria-description={column.type}
                    >
                      {column.name}
                      <span className="type-badge" aria-hidden="true">
                        {column.type}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row, line) => (
                  <tr key={line}>
                    {row.map((cell, index) => (
                      <td key={index} className={preview.columns[index]?.type === 'number' ? 'num' : undefined}>
                        {cell ?? <span className="muted">(null)</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          {preview.row_count > preview.rows.length ? (
            <p className="muted">
              Showing the first {preview.rows.length} of {formatCount(preview.row_count)} rows.
            </p>
          ) : null}
        </div>
      ) : null}
      <ul aria-label="Upload errors" className="upload-errors">
        {errors.map((error, index) => (
          <li key={index}>{error.message}</li>
        ))}
      </ul>
      <div className="form-actions">
        <Button variant="primary" aria-busy={busy || undefined} onClick={() => void sendNow()}>
          Upload
        </Button>
        {retrying ? <Button aria-busy={busy || undefined} onClick={() => void sendNow()}>Try again</Button> : null}
      </div>
      <Status name="Upload state" text={state.text} banner={state.tone === 'outage' || state.tone === 'error'} ok={state.tone === 'done' || state.tone === 'busy'} />
      {finished && done ? done(finished) : null}
    </div>
  );
}
