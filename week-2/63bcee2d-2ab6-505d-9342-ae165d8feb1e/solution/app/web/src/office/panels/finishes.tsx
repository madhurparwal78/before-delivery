import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { flushSync } from "react-dom";
import { call, post } from "../../api";
import { otherIllegal, tooLarge } from "../copy";
import { useOffice, type Role } from "../context";
import { Dialog, focusRefusal, openDialog } from "../dialog";
import { fieldId, useFormId } from "../fields";
import { ActionButton, TableRegion } from "../layout";
import { PanelTitle, useProject } from "../project";
import { useResource } from "../resource";
import { animate } from "./glide";
import "./finishes.css";

// The finishes schedule: reorder by drag or keyboard, import the previous tool's CSV with a per-row report,
// and export the schedule (brief: Finishes, Finishes reorder).

interface Finish {
  id: string;
  position: number;
  code: string | null;
  name: string;
  category: string;
  supplier: string;
  productRef: string;
  location: string;
  notes: string;
}

interface ReportRow {
  line: number;
  status: "created" | "updated" | "unchanged" | "rejected";
  code: string | null;
  name: string | null;
  reason: string | null;
}

interface Report {
  summary: { created: number; updated: number; unchanged: number; rejected: number };
  rows: ReportRow[];
}

const EDITORS: Role[] = ["director", "project_lead", "designer"];
const label = (finish: Finish): string => (finish.code ? `${finish.code} ${finish.name}` : finish.name);
const handleId = (finish: Finish): string => `reorder-${finish.id}`;

interface Pick {
  id: string;
  from: number;
  /** The order before the pick-up, restored on cancel. */
  original: string[];
}

export function FinishesPanel() {
  const { project } = useProject();
  const office = useOffice();
  const editor = !!office.member && EDITORS.includes(office.member.role);
  const finishes = useResource<{ finishes: Finish[] }>(`/api/projects/${project.id}/finishes`);
  const [order, setOrder] = useState<string[] | null>(null);
  const [picked, setPicked] = useState<Pick | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const formId = useFormId("import-finishes");
  const tbody = useRef<HTMLTableSectionElement>(null);
  const tops = useRef<Map<string, number> | null>(null);
  const moving = useRef(false);

  const all = finishes.data?.finishes ?? [];
  const byId = new Map(all.map((finish) => [finish.id, finish]));
  const rows = (order ?? all.map((finish) => finish.id)).map((id) => byId.get(id)).filter((finish): finish is Finish => !!finish);

  // Rows making way slide from where they were over the quick duration.
  useLayoutEffect(() => {
    const before = tops.current;
    tops.current = null;
    if (!before || !tbody.current) return;
    for (const row of Array.from(tbody.current.rows)) {
      const was = before.get(row.dataset.finish ?? "");
      if (was === undefined) continue;
      const delta = was - row.getBoundingClientRect().top;
      if (delta) animate(row, [{ transform: `translateY(${delta}px)` }, { transform: "translateY(0)" }], "--t-quick");
    }
  });

  // Ends any slide still running, so every row sits at its place in the schedule.
  const settle = (): void => {
    for (const row of Array.from(tbody.current?.rows ?? [])) row.getAnimations().forEach((slide) => slide.finish());
  };

  const reorder = (next: string[], focusOn?: string, slide = true): void => {
    settle();
    if (slide) tops.current = new Map(Array.from(tbody.current?.rows ?? []).map((row) => [row.dataset.finish ?? "", row.getBoundingClientRect().top]));
    moving.current = true;
    flushSync(() => setOrder(next));
    if (focusOn) document.getElementById(focusOn)?.focus();
    moving.current = false;
  };

  const save = async (finish: Finish, position: number, ids: string[]): Promise<void> => {
    office.announce("Saving…");
    const result = await post<{ finishes: Finish[] }>(`/api/finishes/${finish.id}/move`, { position });
    if (!result.ok) {
      const body = office.refused(result);
      if (body) office.alert(body.errors?.position ?? otherIllegal(body.error));
      flushSync(() => setOrder(null));
      return;
    }
    await finishes.reload();
    flushSync(() => setOrder(null));
    office.announce(`${label(finish)} dropped at position ${position} of ${ids.length}.`);
  };

  // Cancel puts the row back where it started at once: nothing makes way, the schedule is as it was.
  const cancel = (): void => {
    if (!picked) return;
    const finish = byId.get(picked.id);
    const restore = picked.original;
    flushSync(() => setPicked(null));
    reorder(restore, finish ? handleId(finish) : undefined, false);
    if (finish) office.announce(`Reorder cancelled. ${label(finish)} is back at position ${picked.from + 1} of ${restore.length}.`);
  };

  const onKey = (event: KeyboardEvent<HTMLButtonElement>, finish: Finish): void => {
    const ids = rows.map((row) => row.id);
    const index = ids.indexOf(finish.id);
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!picked) {
        flushSync(() => setPicked({ id: finish.id, from: index, original: ids }));
        office.announce(`Picked up ${label(finish)}. Position ${index + 1} of ${ids.length}. Use the up and down arrow keys to move, Enter to drop, Escape to cancel.`);
      } else if (picked.id === finish.id) {
        flushSync(() => setPicked(null));
        void save(finish, index + 1, ids);
      }
    } else if ((event.key === "ArrowUp" || event.key === "ArrowDown") && picked?.id === finish.id) {
      event.preventDefault();
      const to = index + (event.key === "ArrowUp" ? -1 : 1);
      if (to < 0 || to >= ids.length) return;
      const next = ids.filter((id) => id !== finish.id);
      next.splice(to, 0, finish.id);
      reorder(next, handleId(finish));
      office.announce(`${label(finish)} moved to position ${to + 1} of ${ids.length}.`);
    } else if (event.key === "Escape" && picked) {
      event.preventDefault();
      cancel();
    }
  };

  // A drag follows the pointer on the window: the dragged row moves in the document while rows make way,
  // which would drop a pointer capture held by its handle.
  const current = useRef({ ids: [] as string[], save });
  current.current = { ids: rows.map((row) => row.id), save };

  const pointerDown = (event: PointerEvent<HTMLButtonElement>, finish: Finish): void => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    settle();
    const mids = Array.from(tbody.current?.rows ?? []).map((row) => {
      const box = row.getBoundingClientRect();
      return box.top + box.height / 2;
    });
    const from = rows.indexOf(finish);
    const start = event.clientY;
    const pointer = event.pointerId;
    let moved = false;
    const move = (next: globalThis.PointerEvent): void => {
      if (next.pointerId !== pointer) return;
      if (!moved && Math.abs(next.clientY - start) < 4) return;
      moved = true;
      next.preventDefault();
      const target = mids.filter((mid, index) => index !== from && mid < next.clientY).length;
      const ids = current.current.ids.filter((id) => id !== finish.id);
      ids.splice(target, 0, finish.id);
      if (ids.join() !== current.current.ids.join()) reorder(ids);
    };
    const up = (next: globalThis.PointerEvent): void => {
      if (next.pointerId !== pointer) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (!moved) return;
      const ids = current.current.ids;
      const position = ids.indexOf(finish.id) + 1;
      if (next.type === "pointercancel" || position === from + 1) setOrder(null);
      else void current.current.save(finish, position, ids);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const runImport = async (): Promise<void> => {
    office.announce("Importing…");
    const result = await call<Report>("POST", `/api/projects/${project.id}/finishes/import`, undefined,
      { raw: file ?? "", contentType: "text/csv" });
    if (!result.ok) {
      const body = office.refused(result);
      if (body) {
        const copy = result.status === 413 ? tooLarge(file?.name ?? "The file", Number(body.limitBytes)) : body.errors?.file ?? otherIllegal(body.error);
        flushSync(() => setImportError(copy));
      }
      focusRefusal(openDialog());
      return;
    }
    const data = result.data;
    await finishes.reload();
    flushSync(() => {
      setImporting(false);
      setFile(null);
      setReport(data);
    });
    document.getElementById(`${formId}-report-caption`)?.focus();
    const s = data.summary;
    office.announce(`Import finished: ${s.created} created, ${s.updated} updated, ${s.unchanged} unchanged, ${s.rejected} rejected.`);
  };

  return (
    <>
      <PanelTitle section="finishes" />
      <div className="panel-body finishes">
        <div className="panel-tools">
          <p className="panel-lede">{rows.length} finishes in schedule order. Drag a row by its handle, or press Enter on it to move it with the arrow keys.</p>
          <div className="actions">
            {editor && <button type="button" className="button" onClick={() => {
              setImportError("");
              setFile(null);
              setImporting(true);
            }}>Import CSV</button>}
            <a className="button button-primary" href={`/api/projects/${project.id}/finishes.csv`} download>Export finishes CSV</a>
          </div>
        </div>

        {report && (
          <TableRegion label="Import report, scrollable" className="import-report">
            <table>
              <caption id={`${formId}-report-caption`} tabIndex={-1}>Import report</caption>
              <thead><tr><th scope="col">Line</th><th scope="col">Status</th><th scope="col">Code</th><th scope="col">Name</th><th scope="col">Reason</th></tr></thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={row.line} className={`status-${row.status}`}>
                    <td className="num">{row.line}</td>
                    <td><span className="import-status">{row.status[0].toUpperCase() + row.status.slice(1)}</span></td>
                    <td>{row.code ?? ""}</td>
                    <td>{row.name ?? ""}</td>
                    <td>{row.reason ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableRegion>
        )}

        <TableRegion label="Finishes schedule, scrollable">
          <table className="finishes-table">
            <caption>Finishes schedule</caption>
            <thead>
              <tr>
                <th scope="col">Position</th><th scope="col">Code</th><th scope="col">Name</th><th scope="col">Category</th>
                <th scope="col">Supplier</th><th scope="col">Product ref</th><th scope="col">Location</th>
              </tr>
            </thead>
            <tbody ref={tbody}>
              {rows.map((finish, index) => (
                <tr key={finish.id} data-finish={finish.id} className={picked?.id === finish.id ? "is-picked" : undefined}>
                  <td className="position-cell">
                    {editor && (
                      <button id={handleId(finish)} type="button" className="reorder-handle" aria-describedby={`${formId}-hint`}
                        onKeyDown={(event) => onKey(event, finish)}
                        onBlur={() => {
                          if (!moving.current && picked?.id === finish.id) cancel();
                        }}
                        onPointerDown={(event) => pointerDown(event, finish)}>
                        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
                          <path d="M5 3h2v2H5zM9 3h2v2H9zM5 7h2v2H5zM9 7h2v2H9zM5 11h2v2H5zM9 11h2v2H9z" fill="currentColor" />
                        </svg>
                        Reorder {finish.code ?? finish.name}
                      </button>
                    )}
                    <span className="position-number">{index + 1}</span>
                  </td>
                  <td>{finish.code ?? ""}</td>
                  <td>{finish.name}</td>
                  <td>{finish.category}</td>
                  <td>{finish.supplier}</td>
                  <td>{finish.productRef}</td>
                  <td>{finish.location}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableRegion>
        <p id={`${formId}-hint`} className="visually-hidden">Enter or Space picks the row up. Up and Down move it. Enter drops it. Escape cancels.</p>
      </div>

      <Dialog title="Import finishes" open={importing} onCancel={() => setImporting(false)}
        actions={<ActionButton type="submit" primary pending="Importing…" onAction={runImport}>Import</ActionButton>}>
        <p className="dialog-lede">Choose the CSV exported from the previous tool. Rows match by finish code, then by name.</p>
        <div className="field">
          <label htmlFor={fieldId(formId, "file")}>Legacy CSV file</label>
          <input id={fieldId(formId, "file")} className="input" type="file" accept=".csv,text/csv"
            aria-invalid={importError ? true : undefined} aria-describedby={importError ? `${fieldId(formId, "file")}-error` : undefined}
            onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          {importError && <span className="field-error" id={`${fieldId(formId, "file")}-error`} tabIndex={-1}>{importError}</span>}
        </div>
      </Dialog>
    </>
  );
}
