// Export (Print, Ctrl+P): PDF or DXF of a layout, the list of exports, and the title block revisions.
import { useEffect, useRef, useState } from 'react';
import { COPY } from '../../../shared/copy.ts';
import type { ExportView } from '../../../shared/types.ts';
import { ApiError, authHeaders, get, post } from '../../api.ts';
import { Dialog } from '../../ui/Dialog.tsx';
import { firstFieldMessage, writeRefusal } from '../panels/refusals.ts';
import { useEditor } from '../store.ts';
import { TitleBlockForm } from './TitleBlockDialog.tsx';
import '../../styles/panels.css';

type Row = Pick<ExportView, 'id' | 'file' | 'state' | 'download_url'>;
type Format = ExportView['format'];

const STATE_WORDS: Record<ExportView['state'], string> = { rendering: 'Rendering…', stored: 'Ready', failed: 'Failed' };
/** Real network round trips pace the polling; this only spaces them. */
const POLL_MS = 250;
const MODEL = 'Model';

/** Downloads through fetch so a share-link holder's Authorization header goes along. */
async function saveWithAuth(url: string, file: string): Promise<void> {
  const response = await fetch(url, { headers: authHeaders(), credentials: 'same-origin' });
  if (!response.ok) return;
  const link = document.createElement('a');
  link.href = URL.createObjectURL(await response.blob());
  link.download = file;
  link.click();
  URL.revokeObjectURL(link.href);
}

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const editor = useEditor();
  const drawingId = editor.drawing?.id;
  const layouts = editor.drawing?.layouts ?? [];
  const [view, setView] = useState<'export' | 'titleblock'>('export');
  const [format, setFormat] = useState<Format>('pdf');
  const [layout, setLayout] = useState(layouts.some((item) => item.name === editor.layout) ? editor.layout : MODEL);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const opener = useRef<HTMLButtonElement>(null);
  const announce = useRef(editor.announce);
  announce.current = editor.announce;

  const update = (next: Row): void => {
    setRows((current) => current.map((row) => (row.id === next.id ? { ...row, ...next } : row)));
  };

  /** Follows one export until the server says stored or failed. */
  const watch = async (id: string): Promise<void> => {
    while (alive.current) {
      try {
        const { export: next } = await get<{ export: ExportView }>(`/api/exports/${id}`);
        if (!alive.current) return;
        update(next);
        if (next.state === 'stored') announce.current(`Export ready: ${next.file}`);
        if (next.state === 'failed') announce.current(COPY.storageUnavailableExport);
        if (next.state !== 'rendering') return;
      } catch {
        // The answer did not arrive; ask again.
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  };

  useEffect(() => {
    alive.current = true;
    if (drawingId) {
      void get<{ exports: ExportView[] }>(`/api/drawings/${drawingId}/exports`).then((answer) => {
        if (!alive.current) return;
        setRows((current) => [...current, ...answer.exports.filter((item) => !current.some((row) => row.id === item.id))]);
        for (const item of answer.exports) if (item.state === 'rendering') void watch(item.id);
      });
    }
    return () => { alive.current = false; };
  }, [drawingId]);

  const start = async (): Promise<void> => {
    if (busy || !drawingId) return;
    setBusy(true);
    setError(null);
    try {
      const { export: created } = await post<{ export: Row }>(`/api/drawings/${drawingId}/exports`, {
        format,
        layout: format === 'dxf' ? MODEL : layout,
      });
      setRows((current) => [{ id: created.id, file: created.file, state: 'rendering', download_url: null }, ...current]);
      void watch(created.id);
    } catch (failure) {
      if (!(failure instanceof ApiError)) throw failure;
      setError(failure.status === 422 ? firstFieldMessage(failure) : writeRefusal(failure));
    } finally {
      setBusy(false);
    }
  };

  // The title block view replaces the export view inside the same dialog, so one focus trap is ever active.
  const returned = useRef(false);
  useEffect(() => {
    if (view !== 'export' || !returned.current) return;
    returned.current = false;
    opener.current?.focus();
  }, [view]);

  const backToExport = (): void => {
    returned.current = true;
    setView('export');
  };

  return (
    <Dialog
      label={view === 'export' ? 'Export' : 'Title block A3'}
      onClose={view === 'export' ? onClose : backToExport}
      className="dialog-wide"
    >
      {view === 'titleblock' ? <TitleBlockForm onBack={backToExport} /> : (
        <>
          <h2>Export</h2>
          <div className="export-options">
            <div className="field">
              <span className="label" aria-hidden="true">Format</span>
              <div role="radiogroup" aria-label="Format" className="choice-row">
                <label className="choice">
                  <input type="radio" name="export-format" checked={format === 'pdf'} onChange={() => setFormat('pdf')} />
                  <span>PDF</span>
                </label>
                <label className="choice">
                  <input type="radio" name="export-format" checked={format === 'dxf'} onChange={() => setFormat('dxf')} />
                  <span>DXF</span>
                </label>
              </div>
            </div>
            <div className="field">
              <label htmlFor="export-layout">Layout</label>
              <select id="export-layout" className="input" value={format === 'dxf' ? MODEL : layout} disabled={format === 'dxf'} onChange={(event) => setLayout(event.target.value)}>
                {layouts.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
              </select>
            </div>
          </div>
          {error ? <p role="alert" className="field-error">{error}</p> : null}
          <div className="dialog-actions dialog-actions-start">
            <button type="button" className="btn btn-primary" aria-disabled={busy} onClick={() => void start()}>Export</button>
            <button ref={opener} type="button" className="btn btn-outline" onClick={() => setView('titleblock')}>Title block revisions</button>
          </div>
          <ul className="export-list" aria-label="Exports">
            {rows.map((row) => (
              <li key={row.id} className="panel-item">
                <p className="panel-item-text">{`${row.file} · ${STATE_WORDS[row.state]}`}</p>
                {row.state === 'stored' && row.download_url ? (
                  <div className="panel-item-actions">
                    <a
                      className="btn btn-outline" href={row.download_url} download={row.file} aria-label={`Download ${row.file}`}
                      onClick={(event) => {
                        if (!editor.linkInfo || !row.download_url) return;
                        event.preventDefault();
                        void saveWithAuth(row.download_url, row.file);
                      }}
                    >
                      Download
                    </a>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          <div className="dialog-actions">
            <button type="button" className="btn btn-outline" onClick={onClose}>Close</button>
          </div>
        </>
      )}
    </Dialog>
  );
}
