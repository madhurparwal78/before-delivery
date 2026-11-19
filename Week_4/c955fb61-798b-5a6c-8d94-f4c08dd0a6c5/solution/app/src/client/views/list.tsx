import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { formatLong } from "../../shared/calendar";
import { formatHours, signedVariance } from "../../shared/format";
import { canonicalPredecessors } from "../../shared/predecessors";
import type { Item } from "../../shared/types";
import { moveSentence, percentSentence, resizeSentence, savedSentence } from "../messages";
import type { PatchResult, ProjectSession, SessionState } from "../store";

const COLUMNS = ["Row", "Name", "Start", "End", "Duration", "Predecessors", "Assignees", "% complete", "Variance"] as const;
type Column = (typeof COLUMNS)[number];
const NAME = 1;
const ADD_KEY = "add";
const OPENABLE: readonly Column[] = ["Name", "Start", "Duration", "Predecessors", "% complete"];

interface Cell {
  rowKey: string;
  column: number;
}

interface Editor extends Cell {
  value: string;
  invalid: boolean;
}

interface Props {
  session: ProjectSession;
  state: SessionState;
  openDetails: (itemId: string, opener: HTMLElement | null) => void;
}

const nameOfAssignees = (item: Item): string =>
  [...item.assignees]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((assignee) => `${assignee.name} (${formatHours(assignee.hours)})`)
    .join("; ");

const whole = (value: string, max: number): boolean => /^\d+$/.test(value.trim()) && Number(value) <= max;

// The checks the server makes on the value alone; anything else (milestones, assignees) it still decides.
const looksValid = (column: Column, value: string): boolean => {
  if (column === "Name") return value.trim().length >= 1 && value.trim().length <= 120;
  if (column === "Start") return /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
  if (column === "Duration") return whole(value, 999);
  if (column === "% complete") return whole(value, 100);
  return false;
};

export function TaskList({ session, state, openDetails }: Props) {
  const project = state.project;
  const items = project?.items ?? [];
  const [active, setActive] = useState<Cell>({ rowKey: items[0]?.id ?? ADD_KEY, column: NAME });
  const [editor, setEditor] = useState<Editor | null>(null);
  const cells = useRef(new Map<string, HTMLElement>());
  const wantsFocus = useRef(false);
  const hasFocus = useRef(false);
  const rowKeys = [...items.map((item) => item.id), ADD_KEY];
  const current = rowKeys.includes(active.rowKey) ? active : { rowKey: items[0]?.id ?? ADD_KEY, column: NAME };

  useLayoutEffect(() => {
    const element = cells.current.get(`${current.rowKey}:${current.column}`);
    const lost = hasFocus.current && document.activeElement === document.body;
    if (editor === null && element && (wantsFocus.current || lost)) element.focus();
    wantsFocus.current = false;
  });

  useLayoutEffect(() => {
    const forget = () => {
      hasFocus.current = false;
    };
    document.addEventListener("pointerdown", forget);
    return () => document.removeEventListener("pointerdown", forget);
  }, []);

  if (!project) return null;

  const move = (rowKey: string, column: number) => {
    wantsFocus.current = true;
    setActive({ rowKey, column: Math.max(0, Math.min(COLUMNS.length - 1, column)) });
  };

  const rowOffset = (rowKey: string, delta: number): string => rowKeys[Math.max(0, Math.min(rowKeys.length - 1, rowKeys.indexOf(rowKey) + delta))];

  const itemOf = (rowKey: string): Item | undefined => items.find((candidate) => candidate.id === rowKey);

  const canOpen = (rowKey: string, column: number): boolean => {
    const item = itemOf(rowKey);
    const name = COLUMNS[column];
    if (session.readOnly || !OPENABLE.includes(name)) return false;
    if (rowKey === ADD_KEY) return name === "Name";
    return item?.kind === "group" ? name === "Name" : true;
  };

  const initialValue = (item: Item | undefined, column: number): string => {
    if (!item) return "";
    switch (COLUMNS[column]) {
      case "Name":
        return item.name;
      case "Start":
        return item.chosenStart ?? "";
      case "Duration":
        return String(item.duration);
      case "Predecessors":
        return canonicalPredecessors(item.id, items, project.links);
      default:
        return String(item.percent);
    }
  };

  const open = (cell: Cell, typed: string | null) => {
    if (!canOpen(cell.rowKey, cell.column)) return;
    session.setAlert("");
    setEditor({ ...cell, value: typed ?? initialValue(itemOf(cell.rowKey), cell.column), invalid: false });
  };

  const sentenceFor = (column: Column, previous: Item) => (result: PatchResult): string => {
    if (column === "Start") return moveSentence(result, result.constraint?.predecessor ?? null);
    if (column === "Duration") return result.item.kind === "milestone" || previous.kind === "milestone" ? moveSentence(result, null) : resizeSentence(result);
    if (column === "% complete") return percentSentence(result.item);
    return savedSentence(result.item);
  };

  const commit = async (after: "down" | "right" | "stay", shift: boolean) => {
    if (!editor) return;
    const { rowKey, column, value } = editor;
    const name = COLUMNS[column];
    const item = itemOf(rowKey);
    let accepted: boolean;
    if (rowKey === ADD_KEY) {
      if (value.trim() === "") {
        setEditor(null);
        wantsFocus.current = true;
        return;
      }
      accepted = (await session.createRow(value, shift ? "group" : "task")).ok;
    } else if (!item) {
      return;
    } else if (name === "Predecessors") {
      accepted = (await session.setPredecessors(item, value)).ok;
    } else {
      const payload: Record<string, unknown> =
        name === "Name" ? { name: value } : name === "Start" ? { start: value } : { [name === "Duration" ? "duration" : "percent"]: value.trim() === "" ? null : Number(value) };
      const saving = session.edit(item.id, (live) => ({ payload, sentence: sentenceFor(name, live) }));
      if (looksValid(name, value)) {
        // Close the editor and move on at once so keys pressed during the save reach the grid;
        // a refusal from the server reopens the textbox on its cell with the typed value.
        setEditor(null);
        const target = after === "down" ? rowOffset(rowKey, 1) : rowKey;
        move(target, after === "right" ? column + 1 : column);
        if (!(await saving)) {
          setActive({ rowKey, column });
          setEditor({ rowKey, column, value, invalid: true });
        }
        return;
      }
      accepted = await saving;
    }
    if (!accepted) {
      setEditor((open) => (open ? { ...open, invalid: true } : open));
      return;
    }
    setEditor(null);
    const target = after === "down" ? { rowKey: rowKey === ADD_KEY ? ADD_KEY : rowOffset(rowKey, 1), column } : after === "right" ? { rowKey, column: Math.min(COLUMNS.length - 1, column + 1) } : { rowKey, column };
    move(target.rowKey, target.column);
  };

  const onEditorKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      void commit("down", event.shiftKey);
    } else if (event.key === "Tab" && !event.shiftKey) {
      event.preventDefault();
      void commit("right", false);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setEditor(null);
      wantsFocus.current = true;
    }
  };

  const onCellKeyDown = (event: KeyboardEvent<HTMLElement>, rowKey: string, column: number) => {
    const item = itemOf(rowKey);
    if (event.altKey) {
      if (!item || item.kind === "group") return;
      event.preventDefault();
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        void session.reorder(item, event.key === "ArrowUp" ? "up" : "down").then(() => move(rowKey, column));
      } else if (event.key === "ArrowRight" && !item.group) {
        const above = [...items].filter((candidate) => candidate.kind === "group" && candidate.row < item.row).pop();
        if (above) void session.regroup(item, above).then(() => move(rowKey, column));
      } else if (event.key === "ArrowLeft" && item.group) {
        void session.regroup(item, null).then(() => move(rowKey, column));
      }
      return;
    }
    switch (event.key) {
      case "ArrowRight":
        move(rowKey, column + 1);
        break;
      case "ArrowLeft":
        move(rowKey, column - 1);
        break;
      case "ArrowDown":
        move(rowOffset(rowKey, 1), column);
        break;
      case "ArrowUp":
        move(rowOffset(rowKey, -1), column);
        break;
      case "Home":
        move(rowKey, 0);
        break;
      case "End":
        move(rowKey, COLUMNS.length - 1);
        break;
      case "Enter":
      case "F2":
        if (COLUMNS[column] === "Assignees" && event.key === "Enter" && item) openDetails(item.id, event.currentTarget);
        else open({ rowKey, column }, null);
        break;
      default:
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) open({ rowKey, column }, event.key);
        else return;
    }
    event.preventDefault();
  };

  const cellProps = (rowKey: string, column: number) => ({
    ref: (element: HTMLElement | null) => {
      if (element) cells.current.set(`${rowKey}:${column}`, element);
      else cells.current.delete(`${rowKey}:${column}`);
    },
    tabIndex: current.rowKey === rowKey && current.column === column ? 0 : -1,
    onFocus: () => {
      hasFocus.current = true;
      if (current.rowKey !== rowKey || current.column !== column) setActive({ rowKey, column });
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => onCellKeyDown(event, rowKey, column),
  });

  const content = (item: Item, column: number): string => {
    switch (COLUMNS[column]) {
      case "Row":
        return String(item.row);
      case "Name":
        return item.name;
      case "Start":
        return item.start ? formatLong(item.start) : "";
      case "End":
        return item.end ? formatLong(item.end) : "";
      case "Duration":
        return String(item.duration);
      case "Predecessors":
        return canonicalPredecessors(item.id, items, project.links);
      case "Assignees":
        return nameOfAssignees(item);
      case "% complete":
        return `${item.percent}%`;
      default:
        return item.baseline ? signedVariance(item.baseline.variance) : "";
    }
  };

  const cellBody = (rowKey: string, column: number, text: string) =>
    editor && editor.rowKey === rowKey && editor.column === column ? (
      <input
        type="text"
        aria-label={COLUMNS[column]}
        aria-invalid={editor.invalid ? "true" : undefined}
        value={editor.value}
        autoFocus
        onChange={(event) => setEditor({ ...editor, value: event.target.value, invalid: false })}
        onKeyDown={onEditorKeyDown}
      />
    ) : (
      text
    );

  return (
    <div className="grid-region">
      <table role="grid" aria-label="Task list" className="task-list">
        <thead>
          <tr role="row">
            {COLUMNS.map((name, column) => (
              <th key={name} role="columnheader" scope="col" data-column={column}>
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} role="row" data-item-id={item.id} data-critical={String(item.critical)} data-late={String(item.late)} data-kind={item.kind} aria-busy={state.busy.has(item.id) ? "true" : undefined}>
              {COLUMNS.map((name, column) => (
                <td key={name} role="gridcell" data-column={column} data-name={name} {...cellProps(item.id, column)}>
                  {cellBody(item.id, column, content(item, column))}
                </td>
              ))}
            </tr>
          ))}
          <tr role="row" className="add-row">
            {COLUMNS.map((name, column) => (
              <td key={name} role="gridcell" data-column={column} data-name={name} {...cellProps(ADD_KEY, column)}>
                {column === NAME ? cellBody(ADD_KEY, column, "") : null}
                {column === NAME && !(editor && editor.rowKey === ADD_KEY) ? <span className="add-label">Add task</span> : null}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
