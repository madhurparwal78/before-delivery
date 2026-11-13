import { useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import type { Part, WorkDetail } from '../../../shared/api.js';
import { EN_DASH, MIDDLE_DOT } from '../../../shared/format.js';

export const STORE_OFFLINE_DESCRIPTION_ID = 'score-store-offline-description';

export interface PartsTableProps {
  work: WorkDetail;
  mayEditHoldings: boolean;
  mayUpload: boolean;
  storageDown: boolean;
  onSaveHoldings: (part: Part, copiesOnHand: number) => Promise<void>;
  onRecordMarked: (part: Part) => void;
  onUploadScan: (part: Part, file: File) => void;
  uploadProgress: number | null;
  uploadStatus: string;
}

export function PartsTable({
  work,
  mayEditHoldings,
  mayUpload,
  storageDown,
  onSaveHoldings,
  onRecordMarked,
  onUploadScan,
  uploadProgress,
  uploadStatus,
}: PartsTableProps): JSX.Element {
  const [typed, setTyped] = useState<Record<string, string>>({});
  const focusValues = useRef<Record<string, string>>({});
  const saveSequence = useRef<Record<string, number>>({});
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  async function save(part: Part, raw: string): Promise<void> {
    const value = Number(raw);
    const sequence = (saveSequence.current[part.id] ?? 0) + 1;
    saveSequence.current[part.id] = sequence;
    await onSaveHoldings(part, Number.isFinite(value) ? value : Number.NaN);
    if (saveSequence.current[part.id] !== sequence) return;
    setTyped((current) => {
      const next = { ...current };
      delete next[part.id];
      return next;
    });
  }

  function commit(part: Part): void {
    const shown = typed[part.id];
    if (shown === undefined) return;
    if (shown === focusValues.current[part.id]) return;
    void save(part, shown);
  }

  return (
    <section className="parts-pane">
      <div className="parts-heading">
        <h2 className="pane-heading">Parts</h2>
        <span className="mono">{work.parts_to_mark} to mark</span>
      </div>

      <table role="table" aria-label="Parts" className="parts">
        <thead role="rowgroup">
          <tr role="row">
            <th role="columnheader" scope="col">
              Part
            </th>
            <th role="columnheader" scope="col">
              Bars
            </th>
            <th role="columnheader" scope="col">
              Needed
            </th>
            <th role="columnheader" scope="col">
              On hand
            </th>
            <th role="columnheader" scope="col">
              Short
            </th>
            <th role="columnheader" scope="col">
              Marking
            </th>
            <th role="columnheader" scope="col">
              Scan
            </th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {work.parts.map((part) => (
            <tr role="row" key={part.id}>
              <td role="cell" data-label="Part" className="part-name">
                {part.name}
              </td>
              <td role="cell" data-label="Bars" className="mono">
                {part.bars_from}
                {EN_DASH}
                {part.bars_to}
              </td>
              <td role="cell" data-label="Needed" className="mono">
                {part.copies.needed}
              </td>
              <td role="cell" data-label="On hand">
                <input
                  type="number"
                  className="mono"
                  min={0}
                  max={99}
                  step={1}
                  aria-label={`Copies on hand ${part.name}`}
                  disabled={!mayEditHoldings}
                  value={typed[part.id] ?? String(part.copies.on_hand)}
                  onFocus={(event) => {
                    focusValues.current[part.id] = event.target.value;
                  }}
                  onChange={(event) => {
                    const value = event.target.value;
                    setTyped((current) => ({ ...current, [part.id]: value }));
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      commit(part);
                    }
                  }}
                  onBlur={() => commit(part)}
                />
              </td>
              <td role="cell" data-label="Short" className="mono">
                {part.copies.shortfall > 0 ? (
                  <span>
                    <span className="short-word">Short</span>{' '}
                    <span className="short-value">{part.copies.shortfall}</span>
                  </span>
                ) : (
                  <span>{part.copies.shortfall}</span>
                )}
              </td>
              <td role="cell" data-label="Marking" className="marking">
                {part.mark_cut ? (
                  <span className="flag">
                    <span className="flag-text">Mark cut</span>
                    <button type="button" onClick={() => onRecordMarked(part)}>
                      Record marked {part.name}
                    </button>
                  </span>
                ) : null}
                {part.marks.map((mark) => (
                  <span className="mark-line" key={mark.cut_id}>
                    <span className="mono">
                      {mark.from_bar}
                      {EN_DASH}
                      {mark.to_bar}
                    </span>
                    {` ${MIDDLE_DOT} ${mark.marked_by.name}`}
                  </span>
                ))}
              </td>
              <td role="cell" data-label="Scan" className="scan">
                {mayUpload ? (
                  <>
                    <button
                      type="button"
                      aria-disabled={storageDown ? true : undefined}
                      aria-describedby={storageDown ? STORE_OFFLINE_DESCRIPTION_ID : undefined}
                      className={storageDown ? 'unavailable' : undefined}
                      onClick={() => {
                        if (storageDown) return;
                        fileInputs.current[part.id]?.click();
                      }}
                    >
                      <Upload className="icon" aria-hidden="true" focusable="false" />
                      Upload scan {part.name}
                    </button>
                    <input
                      type="file"
                      className="file-input"
                      tabIndex={-1}
                      aria-hidden="true"
                      accept="application/pdf,image/png,image/jpeg"
                      ref={(element) => {
                        fileInputs.current[part.id] = element;
                      }}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = '';
                        if (file) onUploadScan(part, file);
                      }}
                    />
                  </>
                ) : null}
                {part.latest_marked_scan ? (
                  <a href={`/api/scans/${part.latest_marked_scan.id}/file`} download>
                    <Download className="icon" aria-hidden="true" focusable="false" />
                    Download {part.latest_marked_scan.file_name}
                  </a>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {uploadProgress === null ? null : (
        <div
          role="progressbar"
          aria-label="Upload progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(uploadProgress * 100)}
          className="progress"
        >
          <span className="progress-fill" style={{ width: `${Math.round(uploadProgress * 100)}%` }} />
        </div>
      )}
      <p className="upload-status" role="status" aria-label="Upload status">
        {uploadStatus}
      </p>
    </section>
  );
}
