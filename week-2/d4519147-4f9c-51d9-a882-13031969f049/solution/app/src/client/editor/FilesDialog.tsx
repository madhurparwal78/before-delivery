import { useEffect, useState } from "react";
import { announce } from "../announce.tsx";
import { editorRequest, errorBody, randomKey, readJson, request } from "../api.ts";
import { EmptyTray } from "../icons.tsx";
import { Modal } from "../modal.tsx";

interface ExportFile {
  format: "png" | "svg" | "json";
  sizeBytes: number;
  sha256: string;
}

interface ExportRecord {
  id: string;
  status: "pending" | "ready" | "failed";
  createdAt: string;
  files: ExportFile[];
}

interface ImportRecord {
  id: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
}

const STATUS = { pending: "Preparing", ready: "Ready", failed: "Failed" } as const;
const stamp = (iso: string) => iso.replace("T", " ").slice(0, 16) + " UTC";

export function FilesDialog({ diagramId, canExport, onClose, onStorageDown, onFailure }: {
  diagramId: string; canExport: boolean; onClose(): void; onStorageDown(): void; onFailure(): void;
}) {
  const [exports, setExports] = useState<ExportRecord[] | null>(null);
  const [imports, setImports] = useState<ImportRecord[] | null>(null);

  const load = async () => {
    const [e, i] = await Promise.all([
      request({ method: "GET", path: `/api/diagrams/${diagramId}/exports` }),
      request({ method: "GET", path: `/api/diagrams/${diagramId}/imports` }),
    ]);
    if (e.ok) setExports((await readJson<{ exports: ExportRecord[] }>(e)).exports);
    if (i.ok) setImports((await readJson<{ imports: ImportRecord[] }>(i)).imports);
  };

  useEffect(() => {
    void load();
    // The tables load from the server each time the dialog opens.
  }, []);

  /** A Preparing row is shown until the server answers; only a returned ready export shows Ready and links. */
  const create = async () => {
    const temp: ExportRecord = { id: `pending-${randomKey()}`, status: "pending", createdAt: new Date().toISOString(), files: [] };
    setExports((list) => [temp, ...(list ?? [])]);
    const res = await editorRequest({ method: "POST", path: `/api/diagrams/${diagramId}/exports`, json: {}, headers: { "Idempotency-Key": randomKey() } });
    if (res.status === 201) {
      const record = (await readJson<{ export: ExportRecord }>(res)).export;
      setExports((list) => (list ?? []).map((x) => (x.id === temp.id ? record : x)));
      announce("Export ready.");
      return;
    }
    const code = (await errorBody(res))?.error;
    if (code === "storage_unavailable") onStorageDown();
    else onFailure();
    setExports((list) => (list ?? []).filter((x) => x.id !== temp.id));
    await load();
  };

  return (
    <Modal kind="dialog" label="Diagram files" onClose={onClose} className="dialog-wide">
      <header className="dialog-head"><h2>Diagram files</h2></header>
      {canExport && (
        <div className="dialog-actions">
          <button type="button" className="btn btn-primary" onClick={() => void create()}>Create export</button>
          <p className="hint">A dated PNG, SVG and JSON of every page, listed once storage confirms all three files.</p>
        </div>
      )}
      <h3 className="table-title">Exports</h3>
      <div className="table-wrap">
        <table aria-label="Exports" className="data-table files-table">
          <colgroup><col className="col-created" /><col className="col-status" /><col className="col-format" /><col className="col-size" /><col /></colgroup>
          <thead><tr><th scope="col">Created</th><th scope="col">Status</th><th scope="col">Format</th><th scope="col" className="num">Size (bytes)</th><th scope="col">SHA-256</th></tr></thead>
          {(exports ?? []).map((x) => {
            const head = (span: number) => (
              <>
                <td rowSpan={span} className="mono">{stamp(x.createdAt)}</td>
                <td rowSpan={span}><span className={`chip${x.status === "failed" ? " chip-muted" : ""}`}>{STATUS[x.status]}</span></td>
              </>
            );
            // One sub-row per file of a ready export; pending and failed exports have none.
            return (
              <tbody key={x.id} className="export-group">
                {x.status === "ready" ? (
                  x.files.map((f, i) => (
                    <tr key={f.format}>
                      {i === 0 && head(x.files.length)}
                      <td><a className="link" href={`/api/diagrams/${diagramId}/exports/${x.id}/files/${f.format}`} download>Download {f.format.toUpperCase()}</a></td>
                      <td className="mono num">{f.sizeBytes}</td>
                      <td className="mono hash">{f.sha256}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    {head(1)}
                    <td colSpan={3}>{x.status === "failed" && <span className="row-note">Export failed. File storage did not confirm the files.</span>}</td>
                  </tr>
                )}
              </tbody>
            );
          })}
        </table>
        {exports === null && <div className="skeleton-rows" aria-hidden="true"><span /><span /></div>}
        {exports?.length === 0 && (
          <div className="table-empty"><EmptyTray /><p>No exports yet.{canExport ? " Create one to add a dated set to the assessment report." : ""}</p></div>
        )}
      </div>
      <h3 className="table-title">Imported originals</h3>
      <div className="table-wrap">
        <table aria-label="Imported originals" className="data-table files-table">
          <colgroup><col className="col-file" /><col className="col-size" /><col /></colgroup>
          <thead><tr><th scope="col">File</th><th scope="col" className="num">Size (bytes)</th><th scope="col">SHA-256</th></tr></thead>
          <tbody>
            {(imports ?? []).map((i) => (
              <tr key={i.id}>
                <td><a className="link" href={`/api/diagrams/${diagramId}/imports/${i.id}/original`} download>Download original {i.fileName}</a></td>
                <td className="mono num">{i.sizeBytes}</td>
                <td className="mono hash">{i.sha256}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {imports === null && <div className="skeleton-rows" aria-hidden="true"><span /><span /></div>}
        {imports?.length === 0 && <div className="table-empty"><EmptyTray /><p>No imported files yet.</p></div>}
      </div>
      <footer className="dialog-foot"><button type="button" className="btn" onClick={onClose}>Close</button></footer>
    </Modal>
  );
}
