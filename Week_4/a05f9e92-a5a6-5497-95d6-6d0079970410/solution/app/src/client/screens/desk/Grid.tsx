import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import type { RecordJson } from "../../../server/records.js";
import { PRIORITY_LABELS, SCALE_LABELS, type FieldSpec } from "../../../shared/fields.js";
import type { Table } from "../../../shared/types.js";
import { formatLocalIso } from "../../../shared/tz.js";
import { SlaInline } from "../../components/Sla.js";
import { useAnnounce } from "../../lib/announce.js";
import { ApiFailure, get, patch } from "../../lib/api.js";
import { useSession } from "../../lib/session.js";
import { StatusBlock } from "../../lib/ui.js";
import { assigneeOf, editableField, type Column, type GroupJson, type Row } from "./model.js";

type Item = { kind: "heading"; key: string; text: string } | { kind: "row"; key: string; index: number; row: Row };

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Interleaves group headings (`<label> (<count>)`, counts from the server) with the page's rows. */
function itemsOf(rows: Row[], groupField: string, groups: GroupJson[] | undefined): Item[] {
  const items: Item[] = [];
  let current: unknown = Symbol("none");
  rows.forEach((row, index) => {
    if (groupField && groups) {
      const value = row.summary.values?.[groupField] ?? null;
      if (!sameValue(value, current)) {
        current = value;
        const group = groups.find((g) => sameValue(g.value, value));
        if (group) items.push({ kind: "heading", key: `group:${JSON.stringify(group.value)}`, text: `${group.label} (${group.count})` });
      }
    }
    items.push({ kind: "row", key: row.summary.number, index, row });
  });
  return items;
}

function PriorityBlock({ priority, compact = false }: { priority: number | null; compact?: boolean }): JSX.Element {
  if (priority === null) return <span className="muted">None</span>;
  return <StatusBlock outlined={priority > 2}>{compact ? String(priority) : `${priority} ${PRIORITY_LABELS[priority] ?? ""}`.trim()}</StatusBlock>;
}

function extraText(row: Row, column: Column, zone: string): string {
  const value = row.summary.values?.[column.field ?? ""] ?? null;
  if (value === null || value === "") return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number" && (column.key === "impact" || column.key === "urgency")) return `${value} ${SCALE_LABELS[value] ?? ""}`.trim();
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) return formatLocalIso(value, zone);
  return String(value);
}

function cellContent(row: Row, column: Column, zone: string): ReactNode {
  const { summary } = row;
  switch (column.key) {
    case "number":
      return <strong>{summary.number}</strong>;
    case "short_description":
      return summary.short_description;
    case "priority":
      return <PriorityBlock priority={summary.priority} compact />;
    case "state":
      return <StatusBlock outlined>{summary.state_label}</StatusBlock>;
    case "assigned_to":
      return assigneeOf(summary) ?? <span className="muted">Nobody</span>;
    case "sla":
      return <SlaInline entry={row.sla} />;
    default:
      return extraText(row, column, zone);
  }
}

interface Edit {
  row: number;
  col: number;
  number: string;
  spec: FieldSpec;
  draft: string;
  version: Promise<number | null>;
  users: Array<{ username: string; display_name: string }>;
}

function valueOfDraft(spec: FieldSpec, draft: string): string | number | null {
  if (spec.kind === "integer") return Number(draft);
  return draft.trim() === "" && spec.reference ? null : draft;
}

function draftOf(row: Row, spec: FieldSpec): string {
  if (spec.name === "assigned_to") return row.summary.assigned_to ?? "";
  if (spec.name === "short_description" || spec.name === "title") return row.summary.short_description;
  const value = row.summary.values?.[spec.name];
  return value === null || value === undefined ? "" : String(value);
}

/**
 * The records as an ARIA grid: one tab stop, arrow keys between cells, Enter opens, Space and Shift+arrows select,
 * F2 edits Short description, Assigned to, Impact and Urgency in place.
 */
export function Grid({
  name,
  table,
  rows,
  columns,
  groupField,
  groups,
  selected,
  onSelect,
  openNumber,
  onOpen,
  focusSignal,
  onEdited,
}: {
  name: string;
  table: Table;
  rows: Row[];
  columns: Column[];
  groupField: string;
  groups: GroupJson[] | undefined;
  selected: ReadonlySet<string>;
  onSelect: (next: Set<string>) => void;
  openNumber: string | null;
  onOpen: (number: string) => void;
  focusSignal: number;
  onEdited: () => void;
}): JSX.Element {
  const session = useSession();
  const announce = useAnnounce();
  const root = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState({ row: 0, col: 0 });
  const [edit, setEdit] = useState<Edit | null>(null);
  const [restore, setRestore] = useState<{ row: number; col: number } | null>(null);
  const editor = useRef<HTMLInputElement | HTMLSelectElement | null>(null);
  const setEditor = (element: HTMLInputElement | HTMLSelectElement | null): void => {
    editor.current = element;
  };
  const zone = session.user?.time_zone ?? "UTC";
  const items = itemsOf(rows, groupField, groups);
  const row = Math.min(active.row, Math.max(0, rows.length - 1));
  const col = Math.min(active.col, columns.length - 1);

  const focusCell = (r: number, c: number): void => {
    setActive({ row: r, col: c });
    root.current?.querySelector<HTMLElement>(`[data-cell="${r}:${c}"]`)?.focus();
  };

  const handled = useRef(focusSignal);
  useEffect(() => {
    if (focusSignal !== handled.current) {
      handled.current = focusSignal;
      focusCell(0, 0);
    }
  }, [focusSignal]);

  useLayoutEffect(() => {
    if (restore) {
      focusCell(restore.row, restore.col);
      setRestore(null);
    }
  }, [restore]);

  const editKey = edit ? `${edit.row}:${edit.col}` : "";
  useLayoutEffect(() => {
    editor.current?.focus();
    if (editor.current instanceof HTMLInputElement) editor.current.select();
  }, [editKey]);

  const beginEdit = (r: number, c: number): void => {
    const target = rows[r];
    const column = columns[c];
    if (!target || !column) return;
    const spec = editableField(table, column);
    if (!spec) return;
    const number = target.summary.number;
    const version = get<{ record: RecordJson }>(`/api/records/${number}`).then(
      (loaded) => loaded.record.fields[spec.name]?.version ?? null,
      () => null,
    );
    setEdit({ row: r, col: c, number, spec, draft: draftOf(target, spec), version, users: [] });
    if (spec.name === "assigned_to") {
      void get<{ users: Array<{ username: string; display_name: string }> }>("/api/users").then(
        (loaded) => setEdit((current) => (current && current.number === number ? { ...current, users: loaded.users } : current)),
        () => undefined,
      );
    }
  };

  const save = async (current: Edit): Promise<void> => {
    const version = await current.version;
    try {
      await patch(`/api/records/${current.number}`, { fields: { [current.spec.name]: { value: valueOfDraft(current.spec, current.draft), ...(version === null ? {} : { version }) } } });
      announce(`Saved ${current.number}.`);
      setEdit(null);
      setRestore({ row: current.row, col: current.col });
      onEdited();
    } catch (error) {
      if (error instanceof ApiFailure && error.code === "field_conflict") {
        const conflict = (error.extra.conflicts as Array<{ label: string; theirs_by: string }> | undefined)?.[0];
        announce(`Conflict on ${conflict?.label ?? current.spec.label}: ${conflict?.theirs_by ?? "someone"} saved a newer value.`);
        setEdit(null);
        setRestore({ row: current.row, col: current.col });
        onEdited();
      } else announce(error instanceof ApiFailure ? error.message : "Switchyard could not load this. Try again.");
    }
  };

  const onEditorKey = (event: KeyboardEvent): void => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      if (edit) setRestore({ row: edit.row, col: edit.col });
      setEdit(null);
    } else if (event.key === "Enter" && edit) {
      event.preventDefault();
      void save(edit);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (edit || event.altKey || event.ctrlKey || event.metaKey) return;
    const last = rows.length - 1;
    const move = (r: number, c: number): void => focusCell(Math.max(0, Math.min(last, r)), Math.max(0, Math.min(columns.length - 1, c)));
    const current = rows[row];
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp": {
        event.preventDefault();
        const next = Math.max(0, Math.min(last, row + (event.key === "ArrowDown" ? 1 : -1)));
        if (event.shiftKey && current && rows[next]) {
          const range = new Set(selected);
          range.add(current.summary.number);
          range.add(rows[next]!.summary.number);
          onSelect(range);
        }
        move(next, col);
        break;
      }
      case "ArrowRight":
        event.preventDefault();
        move(row, col + 1);
        break;
      case "ArrowLeft":
        event.preventDefault();
        move(row, col - 1);
        break;
      case "Home":
        event.preventDefault();
        move(row, 0);
        break;
      case "End":
        event.preventDefault();
        move(row, columns.length - 1);
        break;
      case "Enter":
        if (current) {
          event.preventDefault();
          onOpen(current.summary.number);
        }
        break;
      case " ":
        if (current) {
          event.preventDefault();
          const next = new Set(selected);
          if (!next.delete(current.summary.number)) next.add(current.summary.number);
          onSelect(next);
        }
        break;
      case "F2":
        event.preventDefault();
        beginEdit(row, col);
        break;
      default:
    }
  };

  const onCellClick = (event: MouseEvent, r: number, c: number): void => {
    const target = rows[r];
    if (!target) return;
    focusCell(r, c);
    if (event.ctrlKey || event.metaKey) {
      const next = new Set(selected);
      if (!next.delete(target.summary.number)) next.add(target.summary.number);
      onSelect(next);
    } else onOpen(target.summary.number);
  };

  const editorFor = (current: Edit): JSX.Element => {
    const common = { ref: setEditor, "aria-label": current.spec.label, onKeyDown: onEditorKey, className: "cell-editor" };
    if (current.spec.values) {
      return (
        <select {...common} value={current.draft} onChange={(event) => setEdit({ ...current, draft: event.target.value })}>
          {current.spec.values.map((v) => (
            <option key={v} value={v}>{`${v} ${SCALE_LABELS[Number(v)] ?? ""}`.trim()}</option>
          ))}
        </select>
      );
    }
    return (
      <>
        <input {...common} type="text" value={current.draft} list={current.spec.name === "assigned_to" ? "grid-users" : undefined} onChange={(event) => setEdit({ ...current, draft: event.target.value })} />
        {current.spec.name === "assigned_to" ? (
          <datalist id="grid-users">
            {current.users.map((u) => (
              <option key={u.username} value={u.username}>
                {u.display_name}
              </option>
            ))}
          </datalist>
        ) : null}
      </>
    );
  };

  const template = columns.map((c) => (c.key === "short_description" ? `minmax(${c.width}rem, 1fr)` : `${c.width}rem`)).join(" ");
  const minWidth = columns.reduce((sum, c) => sum + c.width, 0);
  return (
    <div className="grid-scroll">
      <div ref={root} role="grid" aria-label={name} aria-multiselectable="true" className="desk-grid" style={{ minWidth: `${minWidth}rem`, ["--cols" as string]: template }} onKeyDown={onKeyDown}>
        <div role="rowgroup">
          <div role="row" className="grid-row grid-head">
            {columns.map((c) => (
              <div key={c.key} role="columnheader" className="grid-cell">
                {c.label}
              </div>
            ))}
          </div>
        </div>
        <div role="rowgroup">
          {items.map((item) =>
            item.kind === "heading" ? (
              <div key={item.key} role="row" className="grid-row grid-group">
                <div role="gridcell" aria-colspan={columns.length} className="grid-cell">
                  <div role="heading" aria-level={3}>
                    {item.text}
                  </div>
                </div>
              </div>
            ) : (
              <div
                key={item.key}
                role="row"
                aria-label={item.row.summary.label}
                aria-selected={selected.has(item.row.summary.number)}
                aria-current={openNumber === item.row.summary.number ? "true" : undefined}
                className="grid-row"
              >
                {columns.map((c, ci) => (
                  <div
                    key={c.key}
                    role="gridcell"
                    data-cell={`${item.index}:${ci}`}
                    tabIndex={item.index === row && ci === col ? 0 : -1}
                    className="grid-cell"
                    onFocus={() => setActive({ row: item.index, col: ci })}
                    onClick={(event) => onCellClick(event, item.index, ci)}
                  >
                    {edit && edit.row === item.index && edit.col === ci ? editorFor(edit) : cellContent(item.row, c, zone)}
                  </div>
                ))}
              </div>
            ),
          )}
        </div>
      </div>
    </div>
  );
}

/** The phone's cards: one `listitem` per record, named with the row label; a tap or Enter opens it. */
export function Cards({
  name,
  rows,
  groupField,
  groups,
  openNumber,
  onOpen,
  focusSignal,
  focusNumber,
}: {
  name: string;
  rows: Row[];
  groupField: string;
  groups: GroupJson[] | undefined;
  openNumber: string | null;
  onOpen: (number: string) => void;
  focusSignal: number;
  focusNumber: string | null;
}): JSX.Element {
  const root = useRef<HTMLUListElement>(null);
  const items = itemsOf(rows, groupField, groups);

  const handled = useRef(focusSignal);
  useEffect(() => {
    if (focusSignal !== handled.current) {
      handled.current = focusSignal;
      root.current?.querySelector<HTMLElement>("[data-number]")?.focus();
    }
  }, [focusSignal]);

  useEffect(() => {
    if (focusNumber) root.current?.querySelector<HTMLElement>(`[data-number="${focusNumber}"]`)?.focus();
  }, [focusNumber]);

  return (
    <ul ref={root} role="list" aria-label={name} className="cards">
      {items.map((item) =>
        item.kind === "heading" ? (
          <li key={item.key} role="presentation" className="cards-group">
            <h3>{item.text}</h3>
          </li>
        ) : (
          <li
            key={item.key}
            data-number={item.row.summary.number}
            aria-label={item.row.summary.label}
            aria-current={openNumber === item.row.summary.number ? "true" : undefined}
            tabIndex={0}
            className="card"
            onClick={() => onOpen(item.row.summary.number)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onOpen(item.row.summary.number);
              }
            }}
          >
            <div className="card-head">
              <strong>{item.row.summary.number}</strong>
              <StatusBlock outlined>{item.row.summary.state_label}</StatusBlock>
            </div>
            <p className="card-title">{item.row.summary.short_description}</p>
            <div className="card-meta">
              <PriorityBlock priority={item.row.summary.priority} />
              <span>{assigneeOf(item.row.summary) ?? <span className="muted">Nobody</span>}</span>
              <SlaInline entry={item.row.sla} />
            </div>
          </li>
        ),
      )}
    </ul>
  );
}
