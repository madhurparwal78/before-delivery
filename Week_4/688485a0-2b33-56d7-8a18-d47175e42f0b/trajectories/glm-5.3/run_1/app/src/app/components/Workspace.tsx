import { ReactNode, useEffect, useRef, useState } from "react";
import { JsonObj, displayValue, displayJson } from "shared/values";
import { QueryAnswer } from "../lib/api";
import { copy, queryStatus } from "../lib/copy";
import { JsonEditor } from "./JsonEditor";

/**
 * The query bar (DP-06, DP-08, DP-16), results views (DP-07, DP-11) and the
 * document editor (DP-49, DP-50, DP-51).
 */

export interface QueryBarState {
  filter: string;
  projection: string;
  sort: string;
  limit: string;
}

export function QueryBar(props: {
  state: QueryBarState;
  onChange: (state: QueryBarState) => void;
  onRun: () => void;
  phone: boolean;
  onPhoneTabChange?: (tab: string) => void;
}): ReactNode {
  const onCtrlEnter = (e: React.KeyboardEvent): void => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      props.onRun();
    }
  };
  return (
    <search
      aria-label="Query bar"
      className="query-bar"
      onKeyDown={onCtrlEnter}
    >
      <label className="field">
        <span className="field-label">Filter</span>
        <input
          aria-label="Filter"
          className="text-input"
          value={props.state.filter}
          onChange={e => props.onChange({ ...props.state, filter: e.target.value })}
          placeholder="{}"
        />
      </label>
      <label className="field">
        <span className="field-label">Projection</span>
        <input
          aria-label="Projection"
          className="text-input"
          value={props.state.projection}
          onChange={e => props.onChange({ ...props.state, projection: e.target.value })}
          placeholder="{}"
        />
      </label>
      <label className="field">
        <span className="field-label">Sort</span>
        <input
          aria-label="Sort"
          className="text-input"
          value={props.state.sort}
          onChange={e => props.onChange({ ...props.state, sort: e.target.value })}
          placeholder="{}"
        />
      </label>
      <label className="field field-limit">
        <span className="field-label">Limit</span>
        <input
          aria-label="Limit"
          className="text-input"
          type="number"
          min={0}
          step={1}
          value={props.state.limit}
          onChange={e => props.onChange({ ...props.state, limit: e.target.value })}
        />
      </label>
      <button className="btn primary" onClick={props.onRun}>Run</button>
    </search>
  );
}

export function ViewSwitch(props: { view: "list" | "table" | "json"; onChange: (v: "list" | "table" | "json") => void }): ReactNode {
  const options: { id: "list" | "table" | "json"; label: string }[] = [
    { id: "list", label: "List" },
    { id: "table", label: "Table" },
    { id: "json", label: "JSON" },
  ];
  const move = (e: React.KeyboardEvent): void => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const idx = options.findIndex(o => o.id === props.view);
    const next = e.key === "ArrowRight" || e.key === "ArrowDown"
      ? options[(idx + 1) % options.length]
      : options[(idx - 1 + options.length) % options.length];
    props.onChange(next.id);
  };
  return (
    <div role="radiogroup" aria-label="View" className="view-switch" onKeyDown={move}>
      {options.map(o => (
        <label key={o.id} className="radio-pill">
          <input
            type="radio"
            name="view"
            checked={props.view === o.id}
            onChange={() => props.onChange(o.id)}
          />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  );
}

/** Top-level field names of the page's documents, in code-unit order, _id first. */
export function gridColumns(docs: JsonObj[], includeId: boolean): string[] {
  const names = new Set<string>();
  for (const doc of docs) {
    for (const k of Object.keys(doc)) {
      if (k !== "_id") names.add(k);
    }
  }
  const sorted = [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return includeId ? ["_id", ...sorted] : sorted;
}

export function ResultsView(props: {
  answer: QueryAnswer | null;
  view: "list" | "table" | "json";
  busy: boolean;
  onOpenDoc: (id: string, opener: HTMLElement) => void;
}): ReactNode {
  if (props.busy || props.answer === null) {
    return <div className="pane-loading" aria-busy="true" />;
  }
  const docs = props.answer.documents as JsonObj[];
  if (props.view === "list") {
    return (
      <ul aria-label="Documents" className="doc-list">
        {docs.map((doc, i) => {
          const id = props.answer?.ids[i] ?? "";
          return (
            <li key={id} data-doc-id={id}>
              <button className="doc-item" onClick={e => props.onOpenDoc(id, e.currentTarget)}>
                {Object.keys(doc).map(k => (
                  <span key={k} className="doc-line">
                    <span className="doc-key">{k}</span>: <span className="doc-val">{displayValue(doc[k])}</span>
                  </span>
                ))}
              </button>
            </li>
          );
        })}
      </ul>
    );
  }
  if (props.view === "table") {
    return <ResultsGrid answer={props.answer} onOpenDoc={props.onOpenDoc} />;
  }
  return (
    <div aria-label="JSON results" className="json-results">
      {docs.map((doc, i) => {
        const id = props.answer?.ids[i] ?? "";
        return (
          <pre key={id} className="json-block" data-doc-id={id}>
            {displayJson(doc)}
          </pre>
        );
      })}
    </div>
  );
}

/** The results grid (DP-07): one tabbable cell, arrows move focus, Enter opens. */
function ResultsGrid(props: { answer: QueryAnswer; onOpenDoc: (id: string, opener: HTMLElement) => void }): ReactNode {
  const gridRef = useRef<HTMLDivElement>(null);
  const docs = props.answer.documents as JsonObj[];
  const includeId = !docs.some(d => !Object.prototype.hasOwnProperty.call(d, "_id")) &&
    props.answer.ids.length > 0;
  const columns = gridColumns(docs, includeId);
  const cellRefs = useRef<HTMLElement[][]>([]);
  const [cursor, setCursor] = useState<[number, number]>([0, 0]);
  const [focusedCell, setFocusedCell] = useState<string | null>(null);

  useEffect(() => {
    // keep exactly one cell in the tab order
    const grid = gridRef.current;
    if (grid === null) return;
    const cells = grid.querySelectorAll("[tabindex='0']");
    cells.forEach(c => c.setAttribute("tabindex", "-1"));
    const first = grid.querySelector<HTMLElement>("[data-row='0'][data-col='0']");
    if (first !== null) first.setAttribute("tabindex", "0");
  }, [docs]);

  const focusCell = (r: number, c: number): void => {
    const rows = docs.length;
    if (rows === 0) return;
    const row = Math.max(0, Math.min(rows - 1, r));
    const col = Math.max(0, Math.min(columns.length - 1, c));
    setCursor([row, col]);
    const cell = cellRefs.current[row]?.[col];
    if (cell !== undefined) {
      const grid = gridRef.current;
      grid?.querySelectorAll("[tabindex='0']").forEach(el => el.setAttribute("tabindex", "-1"));
      cell.setAttribute("tabindex", "0");
      cell.focus();
    }
  };

  if (docs.length === 0) {
    return (
      <div role="grid" aria-label="Documents" aria-rowcount={0} aria-colcount={0} className="doc-grid-empty" />
    );
  }
  return (
    <div
      ref={gridRef}
      role="grid"
      aria-label="Documents"
      className="doc-grid"
      tabIndex={-1}
      onKeyDown={e => {
        const [row, col] = cursor;
        switch (e.key) {
          case "ArrowDown": e.preventDefault(); focusCell(row + 1, col); break;
          case "ArrowUp": e.preventDefault(); focusCell(row - 1, col); break;
          case "ArrowRight": e.preventDefault(); focusCell(row, col + 1); break;
          case "ArrowLeft": e.preventDefault(); focusCell(row, col - 1); break;
          case "Home": e.preventDefault(); focusCell(row, 0); break;
          case "End": e.preventDefault(); focusCell(row, columns.length - 1); break;
          case "Enter": {
            e.preventDefault();
            const id = props.answer.ids[row];
            const cell = cellRefs.current[row]?.[col];
            if (cell !== undefined) props.onOpenDoc(id, cell);
            break;
          }
        }
      }}
    >
      <div role="row" className="grid-row grid-head" aria-rowindex={1}>
        {columns.map(col => (
          <div key={col} role="columnheader" data-field-path={col} className="grid-cell grid-head-cell">
            {col}
          </div>
        ))}
      </div>
      {docs.map((doc, r) => {
        const id = props.answer.ids[r];
        return (
          <div key={id} role="row" className="grid-row" data-doc-id={id} aria-rowindex={r + 2}
            onClick={() => {
              const cell = cellRefs.current[r]?.[0];
              if (cell !== undefined) props.onOpenDoc(id, cell);
            }}
          >
            {columns.map((col, c) => {
              const key = `${r}:${c}`;
              return (
                <div
                  key={col}
                  role="gridcell"
                  ref={el => {
                    if (el !== null) {
                      if (cellRefs.current[r] === undefined) cellRefs.current[r] = [];
                      cellRefs.current[r][c] = el;
                    }
                  }}
                  data-field-path={col}
                  className="grid-cell"
                  tabIndex={r === 0 && c === 0 ? 0 : -1}
                  onFocus={() => setFocusedCell(key)}
                  onBlur={() => setFocusedCell(cur => cur === key ? null : cur)}
                  data-focused={focusedCell === key ? "true" : "false"}
                >
                  {Object.prototype.hasOwnProperty.call(doc, col) ? displayValue(doc[col]) : ""}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

export function Pager(props: {
  page: number;
  pages: number;
  onPrev: () => void;
  onNext: () => void;
}): ReactNode {
  return (
    <div className="pager">
      <button
        className="btn"
        onClick={e => { props.onPrev(); e.currentTarget.focus(); }}
        disabled={props.page <= 1}
      >
        Previous page
      </button>
      <span className="pager-text">Page {props.page} of {props.pages}</span>
      <button
        className="btn"
        onClick={e => { props.onNext(); e.currentTarget.focus(); }}
        disabled={props.page >= props.pages}
      >
        Next page
      </button>
    </div>
  );
}

export function usePages(matched: number, pageSize: number): number {
  return Math.max(1, Math.ceil(matched / pageSize));
}

export function statusFor(q: QueryAnswer | null, pending: boolean, refused: boolean): string {
  if (pending) return queryStatus.pending;
  if (refused) return queryStatus.refused;
  if (q === null) return queryStatus.pending;
  return queryStatus.result(q.matched, q.documents.length);
}

export function EditorPane(props: {
  docId: string | null;
  /** True while a new document is being composed (insert) or one is open. */
  open: boolean;
  text: string;
  onText: (t: string) => void;
  onSave: () => void;
  onClose: () => void;
  onDelete: () => void;
  onReload: () => void;
  onOverwrite: () => void;
  saveStatus: string;
  clash: boolean;
  readOnly: boolean;
  phone: boolean;
  validationChip: { path: string; message: string } | null;
}): ReactNode {
  const hostClasses = "editor-pane";
  const body = (
    <>
      <div className="editor-toolbar">
        {props.readOnly ? null : <button className="btn primary" onClick={props.onSave}>Save</button>}
        <button className="btn" onClick={props.onClose}>Close</button>
        {!props.readOnly && props.docId !== null && (
          <button className="btn danger" onClick={props.onDelete}>Delete document</button>
        )}
      </div>
      <div className="editor-mirror">
        <JsonEditor
          value={props.text}
          onChange={props.readOnly ? undefined : props.onText}
          readOnly={props.readOnly}
          ariaLabel="Document JSON"
          onSave={props.onSave}
        />
      </div>
      {props.validationChip !== null && (
        <div role="alert" className="validation-chip">
          <span aria-hidden="true">&#9888;</span>
          <span className="chip-path">{props.validationChip.path}</span>
          <span className="chip-message">{props.validationChip.message}</span>
        </div>
      )}
      <div role="status" aria-label="Save status" className={`save-status ${props.saveStatus === "Saved" ? "ok" : ""}`}>
        {props.saveStatus}
      </div>
      {props.clash && (
        <div role="alert" className="clash-alert">
          {copy.clash}
          <button className="btn" onClick={props.onReload}>Reload</button>
          <button className="btn" onClick={props.onOverwrite}>Overwrite</button>
        </div>
      )}
    </>
  );
  if (props.phone && props.open) {
    return (
      <div role="dialog" aria-label="Document" className="editor-pane phone-editor">
        {body}
      </div>
    );
  }
  return (
    <section
      aria-label="Document editor"
      className={hostClasses}
      data-editor-scope="true"
    >
      {props.open ? body : <p className="editor-placeholder">Open a document to see it here</p>}
    </section>
  );
}
