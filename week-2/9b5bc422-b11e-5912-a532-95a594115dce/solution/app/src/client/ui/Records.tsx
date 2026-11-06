import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { flushSync } from "react-dom";
import { Download, GripVertical, EllipsisVertical, PanelRight, Plus, Upload } from "lucide-react";
import type { ColumnType } from "../../shared/sync.ts";
import { CSV_LIMIT_BYTES, exportCsv, readCsv } from "../domain/csv.ts";
import type { CellRow } from "../domain/records.ts";
import { cellText, columnTotal, parseCellEdit, parseOptions, rowMatches, rowTitle } from "../domain/records.ts";
import type { CellValue, Column, WorkspaceRecord } from "../domain/types.ts";
import { addColumn, addRow, appendRows, newTable, setCell, setTableName } from "../store/actions.ts";
import { announce } from "../store/announcer.ts";
import { navigate, replaceAddress, takeArrivalFocus } from "../store/router.ts";
import { cellsOf, columnsOf, getRecord, hasNotch, rowsOf, tables } from "../store/workspace.ts";
import { BothKept } from "./BothKept.tsx";
import { Dialog, Empty, Link, Menu, NotFound } from "./common.tsx";
import { InspectorPane } from "./DocumentView.tsx";
import { holdGripTouches, useViewport } from "./hooks.ts";

const COLUMN_TYPES: { label: string; type: ColumnType }[] = [
  { label: "Text", type: "text" },
  { label: "Number", type: "number" },
  { label: "Date", type: "date" },
  { label: "Checkbox", type: "checkbox" },
  { label: "Single select", type: "select" },
];

export function RecordsList() {
  return (
    <div className="screen">
      <h1 className="screen-title">Records</h1>
      <section className="paper list-panel">
        <div className="list-tools">
          <button type="button" className="button" onClick={() => navigate(`/records/${newTable()}?view=table`, "table-name")}><Plus aria-hidden="true" />New table</button>
        </div>
        {tables().length === 0 ? <Empty text="No tables yet." /> : (
          <ul className="rows rows-list" aria-label="Tables">
            {tables().map((table) => (
              <li key={table.id} className="row">
                <div className="row-main">
                  <Link href={`/records/${table.id}`} className="row-title">{table.fields.name}</Link>
                  <span className="row-date">{rowsOf(table.id).length === 1 ? "1 row" : `${rowsOf(table.id).length} rows`}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function AddColumnDialog({ table, onClose }: { table: WorkspaceRecord<"table">; onClose: () => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState<ColumnType>("text");
  const [options, setOptions] = useState("");
  const [error, setError] = useState("");
  const add = (): void => {
    const trimmed = name.trim();
    const parsed = parseOptions(options);
    const problem = !trimmed
      ? "Enter a column name."
      : columnsOf(table).some((column) => column.name === trimmed)
        ? "That column name is already used."
        : type === "select" && parsed.length === 0
          ? "Enter at least one option."
          : "";
    if (problem) {
      setError(problem);
      announce(problem);
      return;
    }
    addColumn(table, { name: trimmed, type, options: parsed });
    onClose();
  };
  return (
    <Dialog name="Add column" onClose={onClose}>
      <form onSubmit={(event) => { event.preventDefault(); add(); }}>
        <label className="field"><span>Column name</span><input value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label className="field">
          <span>Column type</span>
          <select value={type} onChange={(event) => setType(event.target.value as ColumnType)}>
            {COLUMN_TYPES.map((option) => <option key={option.type} value={option.type}>{option.label}</option>)}
          </select>
        </label>
        {type === "select" && <label className="field"><span>Options</span><input value={options} onChange={(event) => setOptions(event.target.value)} /></label>}
        <p className="field-error">{error}</p>
        <div className="dialog-actions">
          <button type="submit" className="button">Add column</button>
          <button type="button" className="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Dialog>
  );
}

function ImportDialog({ table, onClose }: { table: WorkspaceRecord<"table">; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<string[]>([]);
  const run = async (): Promise<void> => {
    if (!file) return;
    if (file.size > CSV_LIMIT_BYTES) return setResult(["That CSV is larger than 1,000,000 bytes."]);
    const read = readCsv(await file.text(), columnsOf(table));
    if (read.kind === "wrong-columns") return setResult([read.message]);
    appendRows(table.id, read.rows);
    const summary = `Imported ${read.rows.length} rows. Skipped ${read.skipped} rows.`;
    announce(summary);
    setResult([summary, ...read.problems]);
  };
  return (
    <Dialog name="Import CSV" onClose={onClose}>
      <label className="field"><span>Choose CSV file</span><input type="file" accept=".csv,text/csv" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
      <div className="dialog-actions">
        <button type="button" className="button" disabled={!file} onClick={() => void run()}>Import</button>
        <button type="button" className="button" onClick={onClose}>Close</button>
      </div>
      <div role="region" aria-label="Import result" className="import-result">
        {result.map((line) => <p key={line}>{line}</p>)}
      </div>
    </Dialog>
  );
}

function CellEditor({ column, value, onSave, onCancel, onMove }: {
  column: Column;
  value: CellValue | undefined;
  onSave: (value: CellValue) => void;
  onCancel: () => void;
  onMove: (value: CellValue) => void;
}) {
  const [draft, setDraft] = useState(column.type === "select" ? String(value ?? "") : cellText(column, value));
  const [error, setError] = useState("");
  const ref = useRef<HTMLInputElement & HTMLSelectElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select?.();
  }, []);
  const attempt = (save: (value: CellValue) => void): void => {
    const parsed = parseCellEdit(column, draft);
    if ("error" in parsed) {
      setError(parsed.error);
      announce(parsed.error);
    } else save(parsed.value);
  };
  const onKey = (event: KeyboardEvent<HTMLElement>): void => {
    event.stopPropagation();
    if (event.key === "Enter") attempt(onSave);
    else if (event.key === "Tab") attempt(onMove);
    else if (event.key === "Escape") onCancel();
    else return;
    event.preventDefault();
  };
  return (
    <>
      {column.type === "select" ? (
        <select ref={ref} className="cell-editor" aria-label={`Edit ${column.name}`} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onKey}>
          <option value="">No value</option>
          {column.options.map((option) => <option key={option}>{option}</option>)}
        </select>
      ) : (
        <input ref={ref} className="cell-editor" aria-label={`Edit ${column.name}`} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onKey} />
      )}
      {error && <p className="field-error">{error}</p>}
    </>
  );
}

type Position = { row: number; column: number };

function Grid({ table, columns, rows, focusRow }: { table: WorkspaceRecord<"table">; columns: Column[]; rows: CellRow[]; focusRow: string | null }) {
  const [active, setActive] = useState<Position>({ row: 0, column: 0 });
  const [editing, setEditing] = useState<Position | null>(null);
  const grid = useRef<HTMLTableElement>(null);
  const cellAt = ({ row, column }: Position): HTMLElement | null | undefined =>
    grid.current?.querySelector<HTMLElement>(`[data-cell="${row}:${column}"]`);
  const focusAt = (position: Position): void => {
    flushSync(() => setActive(position));
    cellAt(position)?.focus();
  };
  useEffect(() => {
    if (focusRow === null) return;
    const row = rows.findIndex((candidate) => candidate.id === focusRow);
    if (row >= 0) focusAt({ row, column: 0 });
  }, [focusRow]);

  const save = (rowIndex: number, column: Column, value: CellValue): void => {
    const row = rows[rowIndex];
    if (row) setCell(row.id, column.id, value);
  };
  const open = (position: Position, column: Column, row: CellRow): void => {
    if (getRecord("row", row.id)?.sync.bothKept[`cell:${column.id}`]) return;
    if (column.type === "checkbox") setCell(row.id, column.id, row.cells[column.id] !== true);
    else setEditing(position);
  };
  const onKey = (event: KeyboardEvent<HTMLTableCellElement>, position: Position, column: Column, row: CellRow): void => {
    if (event.target !== event.currentTarget) return;
    const moves: Record<string, Position> = {
      ArrowLeft: { ...position, column: Math.max(position.column - 1, 0) },
      ArrowRight: { ...position, column: Math.min(position.column + 1, columns.length - 1) },
      ArrowUp: { ...position, row: Math.max(position.row - 1, 0) },
      ArrowDown: { ...position, row: Math.min(position.row + 1, rows.length - 1) },
    };
    const move = moves[event.key];
    if (move) focusAt(move);
    else if (event.key === "Enter") {
      const keep = event.currentTarget.querySelector<HTMLElement>(".keep");
      if (keep) keep.focus();
      else open(position, column, row);
    } else if (event.key === " " && column.type === "checkbox") setCell(row.id, column.id, row.cells[column.id] !== true);
    else return;
    event.preventDefault();
  };

  return (
    <table ref={grid} role="grid" aria-label={table.fields.name} className="grid">
      <thead>
        <tr>{columns.map((column) => <th key={column.id} role="columnheader" scope="col">{column.name}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((row, rowIndex) => {
          const record = getRecord("row", row.id);
          return (
            <tr key={row.id} data-notched={record && hasNotch(record) ? true : undefined}>
              {columns.map((column, columnIndex) => {
                const position = { row: rowIndex, column: columnIndex };
                const isEditing = editing?.row === rowIndex && editing.column === columnIndex;
                const value = row.cells[column.id];
                const kept = record?.sync.bothKept[`cell:${column.id}`];
                const shown = kept ? (kept[0] as CellValue) : value;
                return (
                  <td
                    key={column.id}
                    role="gridcell"
                    data-cell={`${rowIndex}:${columnIndex}`}
                    tabIndex={active.row === rowIndex && active.column === columnIndex ? 0 : -1}
                    className={column.type === "number" ? "cell-number" : undefined}
                    onFocus={(event) => { if (event.target === event.currentTarget) setActive(position); }}
                    onKeyDown={(event) => onKey(event, position, column, row)}
                    onDoubleClick={() => open(position, column, row)}
                  >
                    {isEditing ? (
                      <CellEditor
                        column={column}
                        value={value}
                        onCancel={() => { flushSync(() => setEditing(null)); cellAt(position)?.focus(); }}
                        onSave={(saved) => {
                          save(rowIndex, column, saved);
                          flushSync(() => setEditing(null));
                          cellAt(position)?.focus();
                        }}
                        onMove={(saved) => {
                          save(rowIndex, column, saved);
                          flushSync(() => setEditing(null));
                          const next = columnIndex + 1 < columns.length ? { ...position, column: columnIndex + 1 } : { row: Math.min(rowIndex + 1, rows.length - 1), column: 0 };
                          focusAt(next);
                        }}
                      />
                    ) : column.type === "checkbox" ? (
                      <span className="cell-check" data-checked={shown === true || undefined}><span className="sr-only">{shown === true ? "true" : "false"}</span></span>
                    ) : cellText(column, shown)}
                    {kept && (
                      <BothKept
                        kind="row"
                        id={row.id}
                        field={`cell:${column.id}`}
                        values={kept}
                        text={(each) => cellText(column, each as CellValue)}
                        sentence="Both kept. Two devices changed this cell. Pick the one to keep."
                        onChosen={() => cellAt(position)?.focus()}
                      />
                    )}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr>
          {columns.map((column) => (column.type === "number"
            ? <td key={column.id} role="gridcell" aria-label={`Total ${column.name}`} className="cell-number">{columnTotal(rows, column.id)}</td>
            : <td key={column.id} role="gridcell" />))}
        </tr>
      </tfoot>
    </table>
  );
}

const DRAG_THRESHOLD = 4;
const NO_VALUE = "No value";

function Board({ columns, rows, groupColumn }: { columns: Column[]; rows: CellRow[]; groupColumn: Column }) {
  const [menu, setMenu] = useState<{ row: CellRow; opener: HTMLElement } | null>(null);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const [focusCard, setFocusCard] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const options = [...groupColumn.options, NO_VALUE];
  const valueOf = (row: CellRow): string => String(row.cells[groupColumn.id] ?? "") || NO_VALUE;

  useEffect(() => {
    if (!focusCard) return;
    root.current?.querySelector<HTMLElement>(`[data-board-card="${focusCard}"]`)?.focus();
    setFocusCard(null);
  }, [focusCard]);

  const moveTo = (row: CellRow, option: string): void => {
    setCell(row.id, groupColumn.id, option === NO_VALUE ? "" : option);
    announce(`Moved ${rowTitle(row, columns)} to ${option}.`);
  };
  const startDrag = (row: CellRow, event: ReactPointerEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    const grip = event.currentTarget;
    grip.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startY = event.clientY;
    const move = (moved: PointerEvent): void => {
      const x = moved.clientX - startX;
      const y = moved.clientY - startY;
      if (Math.hypot(x, y) > DRAG_THRESHOLD) setDrag({ id: row.id, x, y });
    };
    const finish = (ended: PointerEvent): void => {
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", finish);
      grip.removeEventListener("pointercancel", cancel);
      setDrag(null);
      const over = document.elementsFromPoint(ended.clientX, ended.clientY)
        .map((element) => element.closest<HTMLElement>("[data-board-column]"))
        .find(Boolean);
      const option = over?.dataset["boardColumn"];
      if (option && option !== valueOf(row)) moveTo(row, option);
    };
    const cancel = (): void => {
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", finish);
      grip.removeEventListener("pointercancel", cancel);
      setDrag(null);
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", finish);
    grip.addEventListener("pointercancel", cancel);
  };
  const onCardKey = (event: KeyboardEvent<HTMLButtonElement>, row: CellRow): void => {
    if (!event.altKey || (event.key !== "ArrowRight" && event.key !== "ArrowLeft")) return;
    event.preventDefault();
    const next = options.indexOf(valueOf(row)) + (event.key === "ArrowRight" ? 1 : -1);
    const option = options[next];
    if (!option) return;
    moveTo(row, option);
    setFocusCard(row.id);
  };

  return (
    <div ref={root} className="board">
      {options.map((option) => {
        const members = rows.filter((row) => valueOf(row) === option);
        return (
          <div key={option} role="group" aria-label={option} className="board-column" data-board-column={option}>
            <h3>{option} <span className="board-count">{members.length}</span></h3>
            {members.map((row) => {
              const title = rowTitle(row, columns);
              const dragged = drag?.id === row.id;
              return (
                <div key={row.id} className={dragged ? "board-card board-card-dragged" : "board-card"} style={dragged ? { transform: `translate(${drag.x}px, ${drag.y}px)` } : undefined}>
                  <button ref={holdGripTouches} type="button" className="board-grip" aria-label={`Drag ${title}`} onPointerDown={(event) => startDrag(row, event)}><GripVertical aria-hidden="true" /></button>
                  <button type="button" className="board-title" data-board-card={row.id} onKeyDown={(event) => onCardKey(event, row)}>{title}</button>
                  <button type="button" className="icon-button" aria-label={`Move ${title}`} aria-haspopup="menu" onClick={(event) => setMenu({ row, opener: event.currentTarget })}><EllipsisVertical aria-hidden="true" /></button>
                </div>
              );
            })}
          </div>
        );
      })}
      {menu && (
        <Menu
          label={`Move ${rowTitle(menu.row, columns)}`}
          opener={menu.opener}
          onClose={() => setMenu(null)}
          items={options.map((option) => ({
            label: option,
            choose: () => {
              moveTo(menu.row, option);
              setFocusCard(menu.row.id);
            },
          }))}
        />
      )}
    </div>
  );
}

function download(name: string, content: string): void {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

function TableName({ table }: { table: WorkspaceRecord<"table"> }) {
  const [draft, setDraft] = useState(table.fields.name);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (takeArrivalFocus() === "table-name") ref.current?.focus();
  }, []);
  return (
    <input
      ref={ref}
      className="table-name"
      aria-label="Table name"
      value={draft}
      onChange={(event) => {
        setDraft(event.target.value);
        if (event.target.value.trim()) setTableName(table.id, event.target.value);
      }}
      onBlur={() => setDraft(table.fields.name)}
    />
  );
}

export function TableView({ tableId, query }: { tableId: string; query: URLSearchParams }) {
  const table = getRecord("table", tableId);
  const viewport = useViewport();
  const [filter, setFilter] = useState("");
  const [dialog, setDialog] = useState<"column" | "import" | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [focusRow, setFocusRow] = useState<string | null>(null);
  const [groupId, setGroupId] = useState("");
  const records = table ? rowsOf(tableId) : [];
  const columns = table ? columnsOf(table) : [];
  const all = records.map(cellsOf);
  const rows = all.filter((row) => rowMatches(row, columns, filter));
  const view = query.get("view") === "board" ? "board" : "table";
  const counted = useRef(`${rows.length}/${all.length}`);
  useEffect(() => {
    const count = `${rows.length}/${all.length}`;
    if (counted.current !== count) announce(`Showing ${rows.length} of ${all.length} rows.`);
    counted.current = count;
  }, [rows.length, all.length]);

  if (!table) return <NotFound heading="We could not find that page." />;
  const selects = columns.filter((column) => column.type === "select");
  const groupColumn = selects.find((column) => column.id === groupId) ?? selects[0];
  const docked = viewport !== "phone";
  const add = (): void => setFocusRow(addRow(tableId, {}));
  return (
    <div className="screen screen-table">
      <div className="paper table-head">
        <TableName table={table} />
        <div role="radiogroup" aria-label="Table view" className="segments">
          {(["table", "board"] as const).map((option) => (
            <label key={option} className="segment">
              <input type="radio" name="table-view" checked={view === option} onChange={() => replaceAddress(`/records/${tableId}?view=${option}`)} />
              <span>{option === "table" ? "Table" : "Board"}</span>
            </label>
          ))}
        </div>
        <input type="search" className="input grow" aria-label="Filter rows" placeholder="Filter rows" value={filter} onChange={(event) => setFilter(event.target.value)} />
        <span role="status" aria-label="Row count" className="count">{rows.length} of {all.length} rows</span>
        <button type="button" className="button" onClick={add}><Plus aria-hidden="true" />Add row</button>
        <button type="button" className="button" onClick={() => setDialog("column")}>Add column</button>
        <button type="button" className="button" onClick={() => download(`${table.fields.name}.csv`, exportCsv(columns, all.map((row) => row.cells)))}><Download aria-hidden="true" />Export CSV</button>
        <button type="button" className="button" onClick={() => setDialog("import")}><Upload aria-hidden="true" />Import CSV</button>
        {!docked && <button type="button" className="button" onClick={() => setInspectorOpen(true)}><PanelRight aria-hidden="true" />Open inspector</button>}
        {view === "board" && groupColumn && (
          <label className="group-by">
            <span>Group by</span>
            <select className="input" value={groupColumn.id} onChange={(event) => setGroupId(event.target.value)}>
              {selects.map((column) => <option key={column.id} value={column.id}>{column.name}</option>)}
            </select>
          </label>
        )}
      </div>
      {view === "table" ? (
        <div className="paper table-paper">
          <div role="region" aria-label="Table rows" className="table-rows">
            <Grid table={table} columns={columns} rows={rows} focusRow={focusRow} />
          </div>
          {rows.length === 0 && <p className="table-empty">No rows match.</p>}
        </div>
      ) : groupColumn ? (
        <Board columns={columns} rows={rows} groupColumn={groupColumn} />
      ) : (
        <div className="paper"><Empty text="Add a single select column to use the board." /></div>
      )}
      <InspectorPane open={docked || inspectorOpen} floating={!docked} onClose={() => setInspectorOpen(false)}>
        <div className="inspector-body">
          <h2 className="inspector-heading">Columns</h2>
          <ul className="column-list">
            {columns.map((column) => (
              <li key={column.id}>
                <span>{column.name}</span>
                <span className="row-date">{COLUMN_TYPES.find((option) => option.type === column.type)?.label}</span>
              </li>
            ))}
          </ul>
        </div>
      </InspectorPane>
      {dialog === "column" && <AddColumnDialog table={table} onClose={() => setDialog(null)} />}
      {dialog === "import" && <ImportDialog table={table} onClose={() => setDialog(null)} />}
    </div>
  );
}
