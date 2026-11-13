// The parts table: one hairline-ruled row per part of the selected work.

import { useEffect, useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import type { Part, WorkDetail } from "../../shared/api";
import { STORE_OUTAGE_ID } from "../status";

export interface UploadProgress {
  partId: string;
  fraction: number;
}

interface PartsTableProps {
  work: WorkDetail;
  storeDown: boolean;
  upload: UploadProgress | null;
  uploadStatus: string;
  onHoldings: (part: Part, value: string) => void;
  onRecordMarked: (part: Part) => void;
  onUpload: (part: Part, file: File) => void;
}

function CopiesInput({ part, onSave }: { part: Part; onSave: (value: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const atFocus = useRef("");
  const onHand = part.copies.on_hand;
  const shown = draft ?? String(onHand);
  useEffect(() => {
    setDraft((current) => (current !== null && Number(current) === onHand ? null : current));
  }, [onHand]);
  const commit = (): void => {
    if (shown === atFocus.current) return;
    atFocus.current = shown;
    onSave(shown);
  };
  return (
    <input
      type="number"
      inputMode="numeric"
      min={0}
      max={99}
      step={1}
      className="copies-input mono"
      aria-label={`Copies on hand ${part.name}`}
      value={shown}
      onFocus={() => {
        atFocus.current = shown;
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
      }}
    />
  );
}

export function PartsTable({ work, storeDown, upload, uploadStatus, onHoldings, onRecordMarked, onUpload }: PartsTableProps) {
  const inputs = useRef(new Map<string, HTMLInputElement>());
  return (
    <section className="parts-pane" aria-labelledby="parts-heading">
      <div className="pane-heading">
        <h2 id="parts-heading" className="pane-heading__title">
          Parts
        </h2>
        <span className="pane-heading__count">
          <span className="mono">{work.parts_to_mark}</span> to mark
        </span>
        <p className="upload-status" role="status" aria-label="Upload status">
          {uploadStatus}
        </p>
      </div>
      <table className="table parts" role="table" aria-label="Parts">
        <colgroup>
          <col className="col-part" />
          <col className="col-bars" />
          <col className="col-figure" />
          <col className="col-hand" />
          <col className="col-figure" />
          <col className="col-marking" />
          <col className="col-scan" />
        </colgroup>
        <thead role="rowgroup">
          <tr role="row">
            <th role="columnheader" scope="col">Part</th>
            <th role="columnheader" scope="col">Bars</th>
            <th role="columnheader" scope="col" className="num">
              Needed
            </th>
            <th role="columnheader" scope="col" className="num">
              On hand
            </th>
            <th role="columnheader" scope="col" className="num">
              Short
            </th>
            <th role="columnheader" scope="col">Marking</th>
            <th role="columnheader" scope="col">Scan</th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {work.parts.map((part) => {
            const uploading = upload?.partId === part.id;
            const scan = part.latest_marked_scan;
            return (
              <tr role="row" key={part.id}>
                <th role="rowheader" scope="row" className="parts__name">
                  {part.name}
                </th>
                <td role="cell" data-label="Bars" className="mono">
                  {part.bars_from}–{part.bars_to}
                </td>
                <td role="cell" data-label="Needed" className="num mono">
                  {part.copies.needed}
                </td>
                <td role="cell" data-label="On hand" className="num">
                  <CopiesInput part={part} onSave={(value) => onHoldings(part, value)} />
                </td>
                <td role="cell" data-label="Short" className="num">
                  {part.copies.shortfall > 0 ? (
                    <span className="short">
                      <span className="caution-mark" aria-hidden="true" />
                      <span className="short__word">Short</span> <span className="mono">{part.copies.shortfall}</span>
                    </span>
                  ) : (
                    <span className="mono">0</span>
                  )}
                </td>
                <td role="cell" data-label="Marking" className="marking">
                  <div className="marking__stack">
                  {part.mark_cut && (
                    <span className="marking__flag">
                      <span className="flag">Mark cut</span>
                      <button
                        type="button"
                        className="button button--small"
                        aria-label={`Record marked ${part.name}`}
                        onClick={() => onRecordMarked(part)}
                      >
                        Record marked
                      </button>
                    </span>
                  )}
                  {part.marks.map((mark) => (
                    <span key={mark.cut_id} className="mark-line">
                      <span className="mono">
                        {mark.from_bar}–{mark.to_bar}
                      </span>{" "}
                      · {mark.marked_by.name}
                    </span>
                  ))}
                  {!part.mark_cut && part.marks.length === 0 && <span className="quiet">—</span>}
                  </div>
                </td>
                <td role="cell" data-label="Scan" className="scan">
                  <button
                    type="button"
                    className="button button--small"
                    aria-label={`Upload scan ${part.name}`}
                    aria-disabled={storeDown ? "true" : undefined}
                    aria-describedby={storeDown ? STORE_OUTAGE_ID : undefined}
                    disabled={uploading}
                    onClick={() => {
                      if (!storeDown) inputs.current.get(part.id)?.click();
                    }}
                  >
                    <Upload aria-hidden="true" />
                    Upload
                  </button>
                  <input
                    type="file"
                    hidden
                    accept="application/pdf,image/png,image/jpeg"
                    ref={(element) => {
                      if (element) inputs.current.set(part.id, element);
                      else inputs.current.delete(part.id);
                    }}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (file) onUpload(part, file);
                    }}
                  />
                  {uploading && (
                    <progress className="progress" aria-label="Upload progress" max={1} value={upload.fraction} />
                  )}
                  {scan && (
                    <a className="download" href={`/api/scans/${scan.id}/file`} download aria-label={`Download ${scan.file_name}`}>
                      <Download aria-hidden="true" />
                      <span className="download__name">{scan.file_name}</span>
                    </a>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
