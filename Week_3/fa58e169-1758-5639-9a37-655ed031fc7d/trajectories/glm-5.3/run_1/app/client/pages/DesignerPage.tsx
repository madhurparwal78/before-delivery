import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import {
  api,
  ApiFail,
  makeOpId,
  readingOrder,
  sideForRow,
  type CellData,
  type MeData,
  type NoteData,
  type PatternData,
  type PatternEntry,
  type RowData,
  type VersionSummary,
} from "../lib/api";
import { StitchGrid, WrittenLines } from "../components/Chart";
import { s, sync, announces, conflictLine, conflictMore } from "../../common/copy";
import { useNotice } from "../lib/hooks";
import { CROCHET_SYMBOLS, KNIT_SYMBOLS, symbolByKey } from "../../common/symbols";
import { NewPatternDialog } from "../components/NewPatternDialog";

interface PeerCursor {
  row: number;
  col: number;
}

interface PresenceEntry {
  userId: string;
  name: string;
}

interface UndoStep {
  kind: "cells" | "mirror" | "repeat" | "expand" | "text";
  label?: string;
  cells?: CellData[];
  repeat?: { id: string; fromCol: number; toCol: number; fromRow: number; toRow: number; times: number };
}

export function DesignerPage(props: { me: MeData; layout: string }): JSX.Element {
  const [pattern, setPattern] = useState<PatternData | null>(null);
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [notes, setNotes] = useState<NoteData[]>([]);
  const [testers, setTesters] = useState<{ name: string; version: number; row: number; notes: number }[]>([]);
  const [cursor, setCursor] = useState({ row: 1, col: 1 });
  const [selection, setSelection] = useState<{ fromRow: number; fromCol: number; toRow: number; toCol: number } | null>(null);
  const [tool, setTool] = useState<"Paint" | "Select">("Paint");
  const [symbol, setSymbol] = useState("k");
  const [colour, setColour] = useState("A");
  const [peers, setPeers] = useState<Record<string, PeerCursor>>({});
  const [presence, setPresence] = useState<PresenceEntry[]>([]);
  const [clipboard, setClipboard] = useState<{ stitch: string; colour: string }[][] | null>(null);
  const [undoStack, setUndoStack] = useState<UndoStep[]>([]);
  const [redoStack, setRedoStack] = useState<UndoStep[]>([]);
  const [editingRow, setEditingRow] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [editPosition, setEditPosition] = useState<number | null>(null);
  const [rowChanged, setRowChanged] = useState<string | null>(null);
  const [flashCells, setFlashCells] = useState<Set<string>>(new Set());
  const [liftedCols, setLiftedCols] = useState<number[]>([]);
  const [liftedToken, setLiftedToken] = useState<{ row: number; tokenIndex: number } | null>(null);
  const [pinnedRows, setPinnedRows] = useState<Set<number>>(new Set());
  const [publishError, setPublishError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<string>("");
  const [cellAnnouncement, setCellAnnouncement] = useState("");
  const [rowCheck, setRowCheck] = useState("");
  const [live, setLive] = useState(true);
  const [tab, setTab] = useState("Chart");
  const [diffQuery, setDiffQuery] = useState<{ a: number; b: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const patternRef = useRef<PatternData | null>(null);
  const editingRowRef = useRef<number | null>(null);
  const noticeTimer = useRef<number | null>(null);

  patternRef.current = pattern;
  editingRowRef.current = editingRow;

  const path = window.location.pathname;
  const patternId = /^\/patterns\/([^/]+)/.exec(path)?.[1] ?? "";

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patternId]);

  const flashTimers = useRef<Map<string, number>>(new Map());

  // A pointer drag shows on release as one request and one undo step: cells
  // collect here and the whole drag commits when it ends.
  const paintRef = useRef<{ row: number; col: number }[]>([]);
  const paintStateRef = useRef<{ cells: CellData[] } | null>(null);
  const paintFrame = useRef<number | null>(null);

  const schedulePaintCommit = (): void => {
    if (paintFrame.current !== null) return;
    paintFrame.current = window.requestAnimationFrame(() => {
      paintFrame.current = null;
      const targets = paintRef.current;
      paintRef.current = [];
      if (targets.length === 0 || !patternRef.current) return;
      if (paintStateRef.current === null) paintStateRef.current = { cells: [] };
      const cells = targets.map((target) => {
        const existing = cellAt(patternRef.current!, target);
        return { ...existing!, stitch: symbol, colour };
      });
      paintStateRef.current.cells.push(...cells);
      // one request per drag: release commits the collected cells
      const state = paintStateRef.current;
      window.setTimeout(() => {
        if (paintStateRef.current !== state) return;
        paintStateRef.current = null;
        if (state.cells.length === 0) return;
        void placeCells(state.cells);
      }, 120);
    });
  };

  const showFlash = (cells: { row: number; col: number }[]) => {
    const next = new Set(flashCells);
    for (const cell of cells) {
      const key = `${cell.row}:${cell.col}`;
      next.add(key);
      const timer = flashTimers.current.get(key);
      if (timer) window.clearTimeout(timer);
      const mine = window.setTimeout(() => {
        setFlashCells((current) => {
          const copy = new Set(current);
          copy.delete(key);
          return copy;
        });
        flashTimers.current.delete(key);
      }, 600);
      flashTimers.current.set(key, mine);
    }
    setFlashCells(next);
  };

  const showConflict = (lines: string[]) => {
    setConflict(lines.join("\n"));
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setConflict(null), noticeSeconds() * 1000);
  };

  async function loadAll(): Promise<void> {
    setLoading(true);
    setLoadError(false);
    try {
      const data = await api<PatternData>(`/api/patterns/${patternId}`);
      setPattern(data);
      const versionList = await api<{ versions: VersionSummary[] }>(`/api/patterns/${patternId}/versions`);
      setVersions(versionList.versions);
      const noteList = await api<{ notes: NoteData[] }>(`/api/patterns/${patternId}/notes`);
      setNotes(noteList.notes);
      const cells = await api<CellData[]>(`/api/patterns/${patternId}/cells`).catch(() => []);
      void cells;
      openSocket();
    } catch (error) {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  function openSocket(): void {
    if (socketRef.current) return;
    const socket = new WebSocket(`${window.location.origin.replace(/^http/, "ws")}/api/patterns/${patternId}/live`);
    socketRef.current = socket;
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as Record<string, unknown>;
      if (message.type === "hello") {
        setLive(message.live === true);
        const entries = message.presence as PresenceEntry[] | undefined;
        if (entries) setPresence(entries);
        return;
      }
      if (message.type === "presence") {
        setPresence((message.presence as PresenceEntry[]) ?? []);
        return;
      }
      if (message.type === "cells") {
        const cells = message.cells as CellData[];
        const rows = message.rows as RowData[];
        if (message.by !== props.me.id) {
          applyPushedCells(cells, rows);
        }
      }
      if (message.type === "cursor") {
        if (message.userId !== props.me.id) {
          const name = String(message.byName ?? "Peer");
          const position = message.cursor as PeerCursor;
          setPeers((current) => ({ ...current, [name]: position }));
        }
      }
      if (message.type === "version") {
        void api<{ versions: VersionSummary[] }>(`/api/patterns/${patternId}/versions`).then((list) => setVersions(list.versions));
      }
      if (message.type === "note") {
        const note = message as { row: number; text: string; testerName: string; version: number };
        setNotes((current) => [...current, { row: note.row, text: note.text, tester: note.testerName, version: note.version }]);
        void refreshTesters();
      }
      if (message.type === "counter") {
        void refreshTesters();
      }
    };
    socket.onclose = () => {
      socketRef.current = null;
    };
  }

  /** Cursor moves reach the other designers with no reload. */
  function publishCursorMove(row: number, col: number): void {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: "cursor", row, col }));
  }

  function applyPushedCells(cells: CellData[], rows: RowData[]): void {
    setPattern((current) => {
      if (!current) return current;
      const nextCells = current.cells.map((cell) => {
        const pushed = cells.find((entry) => entry.row === cell.row && entry.col === cell.col);
        return pushed ? { ...cell, stitch: pushed.stitch, colour: pushed.colour, rev: pushed.rev } : cell;
      });
      return { ...current, cells: nextCells, rows: rows.map((row, index) => ({ ...current.rows[index], ...row })) };
    });
    if (cells.length > 0) {
      showFlash(cells);
      const touchedRows = new Set(cells.map((cell) => cell.row));
      if (editingRowRef.current !== null && touchedRows.has(editingRowRef.current)) {
        setRowChanged(`Row ${editingRowRef.current} changed while you were typing.`);
      }
    }
  }

  async function refreshTesters(): Promise<void> {
    const list = await api<{ testers: { name: string; version: number; row: number; notes: number }[] }>(
      `/api/patterns/${patternId}/testers`,
    ).catch(() => ({ testers: [] }));
    setTesters(list.testers);
  }

  const currentSymbolDef = pattern ? symbolByKey(pattern.craft, symbol) : undefined;

  // Keyboard in the grid
  const onGridKeyDown = (event: React.KeyboardEvent): void => {
    if (!pattern) return;
    if (event.key === "Escape") {
      setSelection(null);
      return;
    }
    const mod = event.ctrlKey || event.metaKey;
    if (mod && (event.key === "c" || event.key === "C")) {
      copySelection();
      event.preventDefault();
      return;
    }
    if (mod && (event.key === "x" || event.key === "X")) {
      cutSelection();
      event.preventDefault();
      return;
    }
    if (mod && (event.key === "v" || event.key === "V")) {
      pasteClipboard();
      event.preventDefault();
      return;
    }
    if (mod && (event.key === "z" || event.key === "Z") && !event.shiftKey) {
      event.preventDefault();
      void doUndo();
      return;
    }
    if ((mod && event.key === "y") || (mod && event.shiftKey && event.key === "Z")) {
      event.preventDefault();
      void doRedo();
      return;
    }
    const cursorCell = cellAt(pattern, cursor);
    if (!cursorCell) return;
    const arrow = arrows[event.key];
    if (arrow) {
      event.preventDefault();
      if (event.shiftKey) {
        extendSelection(arrow);
      } else {
        moveCursor(arrow);
        setSelection(null);
      }
      return;
    }
    if (event.key === "Delete") {
      event.preventDefault();
      void placeCells([{ ...cursorCell, stitch: "ns" }]).then(() => {
        setCellAnnouncement(announces.placed("No stitch", cursor.row, cursor.col));
      });
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      togglePin();
      return;
    }
    const letter = letterForPattern(pattern, event.key);
    if (letter) {
      event.preventDefault();
      placeLetter(letter);
      return;
    }
    if (event.key === "m") {
      event.preventDefault();
      void mirror();
      return;
    }
    if (event.key === "b") {
      event.preventDefault();
      void addRepeatBox();
      return;
    }
    if (["1", "2", "3", "4", "5", "6"].includes(event.key)) {
      const letter = String.fromCharCode(64 + Number(event.key));
      if (pattern.colours.some((entry) => entry.letter === letter)) {
        event.preventDefault();
        placeCells([{ ...cursorCell, colour: letter, stitch: cursorCell.stitch }]);
      }
      return;
    }
  };

  const arrows: Record<string, { row: number; col: number }> = {
    ArrowUp: { row: 1, col: 0 },
    ArrowDown: { row: -1, col: 0 },
    ArrowLeft: { row: 0, col: -1 },
    ArrowRight: { row: 0, col: 1 },
  };

  function letterForPattern(data: PatternData, key: string): string | null {
    if (key === "c" && data.craft === "crochet") return "sc";
    const table = data.craft === "knit" ? KNIT_SYMBOLS : CROCHET_SYMBOLS;
    const found = table.find((entry) => entry.letter === key);
    return found ? found.key : null;
  }

  function moveCursor(delta: { row: number; col: number }): void {
    if (!pattern) return;
    const row = Math.min(Math.max(cursor.row + delta.row, 1), pattern.height);
    const col = Math.min(Math.max(cursor.col + delta.col, 1), pattern.width);
    setCursor({ row, col });
    announceCell(row, col);
  }

  function extendSelection(delta: { row: number; col: number }): void {
    if (!pattern) return;
    const base = selection?.fromRow === undefined ? cursor : { row: selection.fromRow, col: selection.fromCol };
    const toRow = Math.min(Math.max(cursor.row + delta.row, 1), pattern.height);
    const toCol = Math.min(Math.max(cursor.col + delta.col, 1), pattern.width);
    setSelection({ fromRow: base.row, fromCol: base.col, toRow, toCol });
    setCursor({ row: toRow, col: toCol });
    announceCell(toRow, toCol);
  }

  function announceCell(row: number, col: number): void {
    if (!pattern) return;
    const cell = pattern.cells.find((entry) => entry.row === row && entry.col === col);
    if (!cell) return;
    const def = symbolByKey(pattern.craft, cell.stitch);
    setCellAnnouncement(`Row ${row}, column ${col}: ${def?.name ?? "No stitch"}, colour ${cell.colour}.`);
  }

  async function placeLetter(stitch: string): Promise<void> {
    if (!pattern) return;
    const targets = selection ? selectionCells(selection) : [cursor];
    const cells = targets.map((position) => ({
      ...cellAt(pattern, position)!,
      stitch,
    }));
    await placeCells(cells);
    const def = symbolByKey(pattern.craft, stitch);
    setCellAnnouncement(announces.placed(def?.name ?? stitch, cursor.row, cursor.col));
    if (!selection) {
      const side = sideForRow(pattern.mode, cursor.row);
      const order = readingOrder(side, pattern.width);
      const index = order.indexOf(cursor.col);
      if (index >= 0 && index < order.length - 1) {
        const next = order[index + 1]!;
        setCursor({ row: cursor.row, col: next });
      }
    }
  }

  function selectionCells(area: { fromRow: number; fromCol: number; toRow: number; toCol: number }): { row: number; col: number }[] {
    const out: { row: number; col: number }[] = [];
    for (let row = Math.min(area.fromRow, area.toRow); row <= Math.max(area.fromRow, area.toRow); row++) {
      for (let col = Math.min(area.fromCol, area.toCol); col <= Math.max(area.fromCol, area.toCol); col++) {
        out.push({ row, col });
      }
    }
    return out;
  }

  async function placeCells(cells: CellData[]): Promise<void> {
    if (!pattern) return;
    try {
      const response = await api<{
        applied: { row: number; col: number; rev: number }[];
        conflicts: { row: number; col: number; by: string; stitch: string; colour: string; rev: number }[];
        rows: RowData[];
      }>(`/api/patterns/${patternId}/cells`, {
        method: "POST",
        body: JSON.stringify({ opId: makeOpId(), cells: cells.map((cell) => ({ row: cell.row, col: cell.col, stitch: cell.stitch, colour: cell.colour, rev: cell.rev })) }),
      });
      const changedCells: CellData[] = [];
      for (const applied of response.applied) {
        const source = cells.find((cell) => cell.row === applied.row && cell.col === applied.col)!;
        changedCells.push({ ...source, rev: applied.rev });
      }
      pushUndo({ kind: "cells", cells: cells.map((cell) => ({ ...cell, repeat: "" })) });
      applyResponse(changedCells, response.rows);
      reportRowChecks(response.rows);
      if (response.conflicts.length > 0) {
        showConflict(conflictLines(response.conflicts));
      }
    } catch (error) {
      if (error instanceof ApiFail && error.status === 429) {
        setSyncStatus(String(error.payload.message));
        return;
      }
      setSyncStatus(sync.saveFailed);
    }
  }

  function conflictLines(conflicts: { by: string; row: number; col: number }[]): string[] {
    const lines = conflicts.slice(0, 3).map((entry) => conflictLine(entry.by, entry.row, entry.col));
    if (conflicts.length > 3) lines.push(conflictMore(conflicts.length - 3));
    return lines;
  }

  function applyResponse(cells: CellData[], rows: RowData[]): void {
    setPattern((current) => {
      if (!current) return current;
      const byPosition = new Map(cells.map((cell) => [`${cell.row}:${cell.col}`, cell]));
      const nextCells = current.cells.map((cell) => {
        const changed = byPosition.get(`${cell.row}:${cell.col}`);
        return changed ?? cell;
      });
      return { ...current, cells: nextCells, rows: rows };
    });
  }

  function reportRowChecks(rows: RowData[]): void {
    const previous = patternRef.current?.rows ?? [];
    const messages: string[] = [];
    for (const row of rows) {
      const before = previous.find((entry) => entry.row === row.row);
      const beforeErrors = before?.errors ?? [];
      for (const message of row.errors) {
        if (!beforeErrors.includes(message)) messages.push(message);
      }
      if (beforeErrors.length > 0 && row.errors.length === 0) {
        messages.push(announces.rowCorrect(row.row));
      }
    }
    if (messages.length > 0) setRowCheck(messages.join(" "));
  }

  function pushUndo(step: UndoStep): void {
    setUndoStack((current) => {
      const next = [...current, step];
      return next.length > undoDepth() ? next.slice(next.length - undoDepth()) : next;
    });
    setRedoStack([]);
  }

  async function doUndo(): Promise<void> {
    const step = undoStack[undoStack.length - 1];
    if (!step) return;
    setUndoStack((current) => current.slice(0, -1));
    setRedoStack((current) => [...current, step]);
    if (step.kind === "cells" && step.cells && pattern) {
      const previous = step.cells.map((cell) => {
        const now = cellAt(pattern, { row: cell.row, col: cell.col })!;
        return { ...cell, rev: now.rev, repeat: cell.repeat ?? "" };
      });
      // a cell another designer changed after this step is left as it is
      await placeCells(previous);
    }
  }

  async function doRedo(): Promise<void> {
    const step = redoStack[redoStack.length - 1];
    if (!step) return;
    setRedoStack((current) => current.slice(0, -1));
    setUndoStack((current) => [...current, step]);
    if (step.kind === "cells" && step.cells) {
      await placeCells(step.cells);
    }
  }

  function copySelection(): void {
    if (!pattern) return;
    const area = selection ?? { fromRow: cursor.row, fromCol: cursor.col, toRow: cursor.row, toCol: cursor.col };
    const rows: { stitch: string; colour: string }[][] = [];
    for (let row = Math.min(area.fromRow, area.toRow); row <= Math.max(area.fromRow, area.toRow); row++) {
      const line: { stitch: string; colour: string }[] = [];
      for (let col = Math.min(area.fromCol, area.toCol); col <= Math.max(area.fromCol, area.toCol); col++) {
        const cell = cellAt(pattern, { row, col })!;
        line.push({ stitch: cell.stitch, colour: cell.colour });
      }
      rows.push(line);
    }
    setClipboard(rows);
  }

  async function cutSelection(): Promise<void> {
    if (!pattern) return;
    copySelection();
    const area = selection ?? { fromRow: cursor.row, fromCol: cursor.col, toRow: cursor.row, toCol: cursor.col };
    const cells = selectionCells(area).map((position) => ({
      ...cellAt(pattern, position)!,
      stitch: "ns",
      colour: "A",
    }));
    await placeCells(cells);
  }

  async function pasteClipboard(): Promise<void> {
    if (!pattern || !clipboard) return;
    const cells: CellData[] = [];
    let dropped = 0;
    let pasted = 0;
    const total = clipboard.length * clipboard[0]!.length;
    for (let rowOffset = 0; rowOffset < clipboard.length; rowOffset++) {
      for (let colOffset = 0; colOffset < clipboard[rowOffset]!.length; colOffset++) {
        const row = cursor.row + rowOffset;
        const col = cursor.col + colOffset;
        if (row > pattern.height || col > pattern.width) {
          dropped++;
          continue;
        }
        const existing = cellAt(pattern, { row, col })!;
        cells.push({ ...existing, ...clipboard[rowOffset]![colOffset]! });
        pasted++;
      }
    }
    await placeCells(cells);
    if (dropped === 0) setSyncStatus(sync.pasted(pasted));
    else setSyncStatus(sync.pastedPartial(pasted, total, dropped));
  }

  async function mirror(): Promise<void> {
    if (!pattern) return;
    const area = selection ?? { fromRow: cursor.row, fromCol: cursor.col, toRow: cursor.row, toCol: cursor.col };
    try {
      const response = await api<{ applied: CellData[]; rows: RowData[] }>(`/api/patterns/${patternId}/mirror`, {
        method: "POST",
        body: JSON.stringify({
          opId: makeOpId(),
          fromRow: Math.min(area.fromRow, area.toRow),
          toRow: Math.max(area.fromRow, area.toRow),
          fromCol: Math.min(area.fromCol, area.toCol),
          toCol: Math.max(area.fromCol, area.toCol),
        }),
      });
      pushUndo({ kind: "mirror", cells: response.applied.map((cell) => ({ ...cell, repeat: "" })) });
      applyResponse(response.applied, response.rows);
      reportRowChecks(response.rows);
    } catch (error) {
      if (error instanceof ApiFail && error.status === 409) {
        setSyncStatus(sync.mirrorBox);
      }
    }
  }

  async function addRepeatBox(): Promise<void> {
    if (!pattern) return;
    const area = selection ?? { fromRow: cursor.row, fromCol: cursor.col, toRow: cursor.row, toCol: cursor.col };
    try {
      const response = await api<{ id: string; times: number; cells: CellData[]; rows: RowData[] }>(
        `/api/patterns/${patternId}/repeats`,
        {
          method: "POST",
          body: JSON.stringify({
            fromRow: Math.min(area.fromRow, area.toRow),
            toRow: Math.max(area.fromRow, area.toRow),
            fromCol: Math.min(area.fromCol, area.toCol),
            toCol: Math.max(area.fromCol, area.toCol),
          }),
        },
      );
      setPattern((current) =>
        current
          ? {
              ...current,
              cells: response.cells,
              repeats: [
                ...current.repeats,
                {
                  id: response.id,
                  fromCol: Math.min(area.fromCol, area.toCol),
                  toCol: Math.max(area.fromCol, area.toCol),
                  fromRow: Math.min(area.fromRow, area.toRow),
                  toRow: Math.max(area.fromRow, area.toRow),
                  times: response.times,
                },
              ],
            }
          : current,
      );
      reportRowChecks(response.rows);
    } catch (error) {
      if (error instanceof ApiFail && error.status === 409) {
        setSyncStatus(sync.overlap);
      }
    }
  }

  function togglePin(): void {
    const next = new Set(pinnedRows);
    if (next.has(cursor.row)) next.delete(cursor.row);
    else next.add(cursor.row);
    setPinnedRows(next);
  }


  /** The open row's edit box: it keeps its text, caret and error through pushes. */
  const editBox = editingRow !== null ? (
    <div className="edit-box">
      <label htmlFor={`row-${editingRow}-instructions`} className="sr-only">{`Row ${editingRow} instructions`}</label>
      <textarea
        id={`row-${editingRow}-instructions`}
        className="row-edit"
        aria-label={`Row ${editingRow} instructions`}
        aria-invalid={editError ? "true" : undefined}
        value={editText}
        ref={(element) => {
          if (element && element.selectionStart === 0 && editPosition !== null && editError !== null) {
            element.setSelectionRange(Math.max(editPosition - 1, 0), Math.max(editPosition - 1, 0));
          }
        }}
        onChange={(event) => setEditText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void applyEditText();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            setEditingRow(null);
            setEditError(null);
            setRowChanged(null);
          }
        }}
      />
      <div className="actions">
        <button type="button" className="button-plain" onClick={() => void applyEditText()}>
          Apply text
        </button>
      </div>
      {editError ? (
        <p className="alert" role="alert" aria-label="Text error">
          {editError}
        </p>
      ) : null}
      {rowChanged ? (
        <p className="status" role="status" aria-label="Row changed">
          {rowChanged}
        </p>
      ) : null}
    </div>
  ) : null;

  if (loading) {
    return (
      <>
        <h1 className="lead">{s.loading}</h1>
        <div className="panel" />
      </>
    );
  }

  if (loadError || !pattern) {
    return (
      <>
        <h1 className="lead">{s.pageError}</h1>
        <div className="panel" />
      </>
    );
  }

  const errors = pattern.rows.filter((row) => row.errors.length > 0);
  const leadLine = errors.length > 0 ? errors[0]!.errors[0]! : s.allRowsOk;
  const symbols = pattern.craft === "knit" ? KNIT_SYMBOLS : CROCHET_SYMBOLS;

  return (
    <>
      {props.layout !== "desktop" ? (
        <div className="tabs" role="tablist" aria-label="Pattern">
          {["Chart", "Instructions", "Testers"].map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={tab === name}
              className="tab"
              onClick={() => setTab(name)}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                  const index = ["Chart", "Instructions", "Testers"].indexOf(tab);
                  const next = (index + (event.key === "ArrowRight" ? 1 : 2)) % 3;
                  setTab(["Chart", "Instructions", "Testers"][next]!);
                }
              }}
            >
              {name}
            </button>
          ))}
        </div>
      ) : null}
      <div className={props.layout === "desktop" ? "designer-columns" : undefined}>
        {(props.layout === "desktop" || tab === "Chart") && (
        <section aria-label="Chart" className="panel">
          <div className="toolbar">
            <div className="tool-group" role="radiogroup" aria-label="Tool">
              {["Paint", "Select"].map((name) => (
                <button
                  key={name}
                  type="button"
                  role="radio"
                  aria-checked={tool === name}
                  className="tool-pill"
                  data-checked={tool === name ? "true" : "false"}
                  onClick={() => setTool(name as "Paint" | "Select")}
                >
                  {name}
                </button>
              ))}
            </div>
            <div className="tool-group" role="radiogroup" aria-label="Symbols">
              {symbols.map((entry, index) => (
                <button
                  key={entry.key}
                  type="button"
                  role="radio"
                  aria-checked={symbol === entry.key}
                  className="tool-pill"
                  data-checked={symbol === entry.key ? "true" : "false"}
                  onClick={() => setSymbol(entry.key)}
                  aria-label={entry.name}
                >
                  {entry.name}
                </button>
              ))}
            </div>
            <div className="tool-group" role="radiogroup" aria-label="Colours">
              {pattern.colours.map((entry) => (
                <button
                  key={entry.letter}
                  type="button"
                  role="radio"
                  aria-checked={colour === entry.letter}
                  className="tool-pill"
                  data-checked={colour === entry.letter ? "true" : "false"}
                  onClick={() => setColour(entry.letter)}
                  aria-label={`${entry.letter} ${entry.name}`}
                >
                  {entry.letter}
                </button>
              ))}
            </div>
            <div className="tool-group">
              <button type="button" className="button-plain" onClick={() => void addRepeatBox()}>
                Add repeat
              </button>
              <button type="button" className="button-plain" onClick={() => void mirror()}>
                Mirror
              </button>
            </div>
          </div>
          <div onKeyDown={onGridKeyDown}>
            <StitchGrid
              pattern={pattern}
              cursor={cursor}
              tool={tool}
              onCursor={(row, col) => {
                setCursor({ row, col });
                publishCursorMove(row, col);
              }}
              onPaint={(cells) => {
                if (tool !== "Paint") return;
                paintRef.current.push(...cells);
                schedulePaintCommit();
              }}
              onSelectDrag={(area) => {
                setSelection(area);
                const rows = Math.abs(area.toRow - area.fromRow) + 1;
                const cols = Math.abs(area.toCol - area.fromCol) + 1;
                setSyncStatus(sync.selected(rows, cols));
              }}
              selection={selection}
              peers={peers}
              flashCells={flashCells}
              liftedCols={liftedCols}
              reducedMotion={props.me.reduceMotion}
            />
          </div>
        </section>
        )}
        {(props.layout === "desktop" || tab === "Instructions") && (
        <section aria-label="Instructions" className="panel">
          <WrittenLines
            pattern={pattern}
            onEdit={(row) => openEdit(row)}
            onPin={(row) => togglePinRow(row)}
            pinnedRows={pinnedRows}
            liftedToken={liftedToken}
            onTokenLift={(_row, _index, cols) => setLiftedCols(cols)}
            onTokenLeave={() => setLiftedCols([])}
          />
          {editBox}
        </section>
        )}
      </div>
      <StatusStrip
        cellAnnouncement={cellAnnouncement}
        rowCheck={rowCheck}
        syncStatus={syncStatus}
        conflict={conflict}
        rowChanged={rowChanged}
        live={live}
      />
      {props.layout === "desktop" ? (
        <SidePanels
          pattern={pattern}
          versions={versions}
          notes={notes}
          testers={testers}
          onSaveVersion={saveVersion}
          onPublish={publish}
          onRestore={restoreVersion}
          syncText={syncStatus}
        />
      ) : null}
      {props.layout !== "desktop" && tab === "Chart" ? (
        <div className="side-grid">
          <RepeatsPanel pattern={pattern} />
          <ColourKeyPanel pattern={pattern} />
          <ErrorsPanel pattern={pattern} />
          <WarningsPanel pattern={pattern} />
          <PresencePanel presence={presence} me={props.me} />
        </div>
      ) : null}
      {props.layout !== "desktop" && tab === "Testers" ? (
        <div className="side-grid">
          <VersionsPanel
            pattern={pattern}
            versions={versions}
            syncText={syncStatus}
            onSaveVersion={saveVersion}
            onPublish={publish}
            onRestore={restoreVersion}
          />
          <TestersPanel pattern={pattern} testers={testers} />
          <NotesPanel notes={notes} />
        </div>
      ) : null}
      <p className="sr-only" role="status" aria-label="Lead line">
        {leadLine}
      </p>
    </>
  );

  function openEdit(row: number): void {
    const rowInfo = pattern?.rows[row - 1];
    if (!rowInfo) return;
    const box = pattern?.repeats.find((entry) => row >= entry.fromRow && row <= entry.toRow);
    if (box) {
      setEditError(`Row ${row}: expand repeat ${box.id} before editing this row as text.`);
      setEditingRow(row);
      setEditText(rowInfo.text);
      return;
    }
    setEditingRow(row);
    setEditText(rowInfo.text);
    setEditError(null);
    setEditPosition(null);
  }

  function togglePinRow(row: number): void {
    const next = new Set(pinnedRows);
    if (next.has(row)) next.delete(row);
    else next.add(row);
    setPinnedRows(next);
  }

  async function saveVersion(note: string): Promise<void> {
    const result = await api<{ version: number }>(`/api/patterns/${patternId}/versions`, {
      method: "POST",
      body: JSON.stringify({ note }),
    });
    setVersions((current) => [
      ...current,
      { version: result.version, note, savedOn: todayString(), stitches: 0 },
    ]);
    setSyncStatus(sync.versionSaved(result.version));
  }

  async function publish(): Promise<void> {
    const result = await api<{ state: string; version: number }>(`/api/patterns/${patternId}/publish`, {
      method: "POST",
    });
    setSyncStatus(sync.published(result.version));
  }

  async function restoreVersion(version: number): Promise<void> {
    const result = await api<{ version: number; restoredFrom: number }>(
      `/api/patterns/${patternId}/versions/${version}/restore`,
      { method: "POST" },
    );
    setSyncStatus(sync.restored(result.restoredFrom, result.version));
    setUndoStack([]);
    setRedoStack([]);
    await loadAll();
  }

  async function applyEditText(): Promise<void> {
    if (editingRow === null || !pattern) return;
    try {
      const response = await api<{ changed: number; cells: CellData[]; rows: RowData[] }>(
        `/api/patterns/${patternId}/text`,
        {
          method: "POST",
          body: JSON.stringify({ row: editingRow, text: editText }),
        },
      );
      pushUndo({ kind: "text", cells: response.cells.map((cell) => ({ ...cell, repeat: "" })) });
      applyResponse(response.cells, response.rows);
      reportRowChecks(response.rows);
      setSyncStatus(sync.rowUpdated(editingRow, response.changed));
      setEditingRow(null);
      setEditError(null);
      setRowChanged(null);
    } catch (error) {
      if (error instanceof ApiFail && error.status === 422) {
        const message = String(error.payload.message ?? "");
        const position = typeof error.payload.position === "number" ? (error.payload.position as number) : null;
        setEditError(message);
        setEditPosition(position);
      }
    }
  }
}

function cellAt(pattern: PatternData, position: { row: number; col: number }): CellData | undefined {
  return pattern.cells.find((cell) => cell.row === position.row && cell.col === position.col);
}

function noticeSeconds(): number {
  return 6;
}

function undoDepth(): number {
  return 100;
}

function todayString(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return parts;
}

function StatusStrip(props: {
  cellAnnouncement: string;
  rowCheck: string;
  syncStatus: string;
  conflict: string | null;
  rowChanged: string | null;
  live: boolean;
}): JSX.Element {
  return (
    <div className="sr-only">
      <p className="status" role="status" aria-live="polite" aria-label="Cell announcement">
        {props.cellAnnouncement}
      </p>
      <p className="status" role="status" aria-live="polite" aria-label="Row check">
        {props.rowCheck}
      </p>
      <p className="status" role="status" aria-live="polite" aria-label="Chart sync">
        {props.syncStatus}
      </p>
      <p className="alert" role="alert" aria-label="Conflict">
        {props.conflict ?? ""}
      </p>
      <p className="status" role="status" aria-label="Row changed">
        {props.rowChanged ?? ""}
      </p>
      <p className="status" role="status" aria-label="Live">
        {props.live ? s.liveOn : s.liveOff}
      </p>
    </div>
  );
}

function RepeatsPanel(props: { pattern: PatternData }): JSX.Element {
  const [status, setStatus] = useState("");
  return (
    <section className="panel" aria-label="Repeats">
      <h2>Repeats</h2>
      {props.pattern.repeats.length === 0 ? (
        <ul className="panel-list" role="list" aria-label="Repeats">
          <li>{s.noRepeats}</li>
        </ul>
      ) : (
        <ul className="panel-list" role="list" aria-label="Repeats">
          {props.pattern.repeats.map((box) => (
            <li key={box.id}>
              {`Repeat ${box.id}`}{" "}
              <input
                type="number"
                min={2}
                max={20}
                defaultValue={box.times}
                aria-label={`Times for ${box.id}`}
                onBlur={async (event) => {
                  const times = Number(event.target.value);
                  try {
                    await api(`/api/patterns/${props.pattern.id}/repeats/${box.id}`, {
                      method: "PATCH",
                      body: JSON.stringify({ times }),
                    });
                  } catch (error) {
                    if (error instanceof ApiFail && error.status === 422) setStatus(sync.timesRange);
                  }
                }}
                style={{ width: 64, minHeight: 44 }}
              />{" "}
              <button type="button" className="button-plain" aria-label={`Expand repeat ${box.id}`} onClick={async () => {
                try {
                  await api(`/api/patterns/${props.pattern.id}/repeats/${box.id}/expand`, { method: "POST" });
                } catch (error) {
                  if (error instanceof ApiFail && error.status === 409) setStatus(sync.tooWide(80));
                }
              }}>
                Expand
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="status" role="status">{status}</p>
    </section>
  );
}

function ColourKeyPanel(props: { pattern: PatternData }): JSX.Element {
  return (
    <section className="panel" aria-label="Colour key">
      <h2>Colour key</h2>
      <ul className="panel-list" role="list" aria-label="Colour key">
        {props.pattern.colours.map((colour) => (
          <li key={colour.letter}>{`${colour.letter} ${colour.name}`}</li>
        ))}
      </ul>
    </section>
  );
}

function ErrorsPanel(props: { pattern: PatternData }): JSX.Element {
  const errors = props.pattern.rows.filter((row) => row.errors.length > 0);
  return (
    <section className="panel" aria-label="Row errors">
      <h2>Row errors</h2>
      <ul className="panel-list" role="list" aria-label="Row errors">
        {errors.length === 0 ? (
          <li>{s.allRowsOk}</li>
        ) : (
          errors.map((row) =>
            row.errors.map((message) => (
              <li key={`${row.row}-${message}`} data-row={row.row}>
                <button type="button" className="error-link" onClick={() => window.dispatchEvent(new CustomEvent("goto-row", { detail: row.row }))}>
                  {message}
                </button>
              </li>
            )),
          )
        )}
      </ul>
    </section>
  );
}

function WarningsPanel(props: { pattern: PatternData }): JSX.Element {
  const warnings = props.pattern.colourWarnings ?? [];
  return (
    <section className="panel" aria-label="Colour warnings">
      <h2>Colour warnings</h2>
      <ul className="panel-list" role="list" aria-label="Colour warnings">
        {warnings.length === 0 ? <li>{s.noColourWarnings}</li> : warnings.map((warning) => (
          <li key={`${warning.row}-${warning.message}`} data-row={warning.row}>{warning.message}</li>
        ))}
      </ul>
    </section>
  );
}

function PresencePanel(props: { presence: PresenceEntry[]; me: MeData }): JSX.Element {
  const meFirst = [
    { userId: props.me.id, name: `${props.me.name} ${s.viewerYou}` },
    ...props.presence.filter((entry) => entry.userId !== props.me.id),
  ];
  return (
    <section className="panel" aria-label="Here now">
      <h2>Here now</h2>
      <ul className="panel-list" role="list" aria-label="Here now">
        {meFirst.map((entry) => (
          <li key={entry.userId}>{entry.name}</li>
        ))}
      </ul>
    </section>
  );
}

function SidePanels(props: {
  pattern: PatternData;
  versions: VersionSummary[];
  notes: NoteData[];
  testers: { name: string; version: number; row: number; notes: number }[];
  onSaveVersion: (note: string) => Promise<void>;
  onPublish: () => Promise<void>;
  onRestore: (version: number) => Promise<void>;
  syncText: string;
}): JSX.Element {
  return (
    <div className="side-grid">
      <RepeatsPanel pattern={props.pattern} />
      <ColourKeyPanel pattern={props.pattern} />
      <ErrorsPanel pattern={props.pattern} />
      <WarningsPanel pattern={props.pattern} />
      <PresencePanel presence={[]} me={{ id: "", name: "", email: "", reduceMotion: false }} />
      <VersionsPanel
        pattern={props.pattern}
        versions={props.versions}
        syncText={props.syncText}
        onSaveVersion={props.onSaveVersion}
        onPublish={props.onPublish}
        onRestore={props.onRestore}
      />
      <TestersPanel pattern={props.pattern} testers={props.testers} />
      <NotesPanel notes={props.notes} />
    </div>
  );
}

function VersionsPanel(props: {
  pattern: PatternData;
  versions: VersionSummary[];
  onSaveVersion: (note: string) => Promise<void>;
  onPublish: () => Promise<void>;
  onRestore: (version: number) => Promise<void>;
  syncText: string;
}): JSX.Element {
  const [noteDialog, setNoteDialog] = useState(false);
  const [note, setNote] = useState("");
  const [restoreTarget, setRestoreTarget] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const publishError = useNotice(6);

  return (
    <section className="panel" aria-label="Versions">
      <h2>Versions</h2>
      <div className="actions">
        <button
          type="button"
          className="button-primary"
          aria-busy={busy}
          disabled={busy}
          onClick={() => {
            setNote("");
            setNoteDialog(true);
          }}
        >
          Save version
        </button>
        <button
          type="button"
          className="button-plain"
          aria-busy={busy}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await props.onPublish();
            } catch (failure) {
              if (failure instanceof ApiFail) {
                publishError.show(String(failure.payload.message ?? ""));
              }
            }
            setBusy(false);
          }}
        >
          Publish
        </button>
      </div>
      <p className="alert" role="alert" aria-label="Publish error">
        {publishError.text}
      </p>
      <table className="data-table" aria-label="Versions">
        <thead>
          <tr>
            <th>Version</th>
            <th>Note</th>
            <th>Saved on</th>
            <th>Stitches</th>
          </tr>
        </thead>
        <tbody>
          {props.versions.map((version) => (
            <tr key={version.version}>
              <td>{version.version}</td>
              <td>{version.note}</td>
              <td>{version.savedOn}</td>
              <td>{version.stitches}</td>
              <td>
                <button
                  type="button"
                  className="button-plain"
                  aria-label={`Restore version ${version.version}`}
                  onClick={() => setRestoreTarget(version.version)}
                >
                  Restore
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {noteDialog ? (
        <div className="dialog-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setNoteDialog(false); }}>
          <div className="dialog" role="dialog" aria-label="Save version" onKeyDown={(event) => { if (event.key === "Escape") setNoteDialog(false); }}>
            <h2>Save version</h2>
            <div className="field">
              <label htmlFor="version-note">Version note</label>
              <input
                id="version-note"
                value={note}
                aria-label="Version note"
                aria-invalid={error ? "true" : undefined}
                onChange={(event) => setNote(event.target.value)}
              />
            </div>
            {error ? (
              <p className="alert" role="alert" aria-label="Version error">
                {error}
              </p>
            ) : null}
            <div className="actions">
              <button type="button" className="button-plain" onClick={() => setNoteDialog(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="button-primary"
                aria-busy={busy}
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await props.onSaveVersion(note);
                    setNoteDialog(false);
                    setError(null);
                  } catch (failure) {
                    if (failure instanceof ApiFail && failure.status === 422) {
                      setError(String(failure.payload.message ?? ""));
                    }
                  }
                  setBusy(false);
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {restoreTarget !== null ? (
        <div className="dialog-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setRestoreTarget(null); }}>
          <div className="dialog" role="dialog" aria-label={`Restore version ${restoreTarget}?`} onKeyDown={(event) => { if (event.key === "Escape") setRestoreTarget(null); }}>
            <h2>{`Restore version ${restoreTarget}?`}</h2>
            <p>{`This makes version ${props.versions.length + 1} from version ${restoreTarget}. Nothing is deleted.`}</p>
            <div className="actions">
              <button type="button" className="button-plain" onClick={() => setRestoreTarget(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="button-primary"
                aria-busy={busy}
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  await props.onRestore(restoreTarget);
                  setRestoreTarget(null);
                  setBusy(false);
                }}
              >
                Restore
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function TestersPanel(props: { pattern: PatternData; testers: { name: string; version: number; row: number; notes: number }[] }): JSX.Element {
  return (
    <section className="panel" aria-label="Testers">
      <h2>Testers</h2>
      <table className="data-table" aria-label="Testers">
        <thead>
          <tr>
            <th>Name</th>
            <th>Version</th>
            <th>Row</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {props.testers.map((tester) => (
            <tr key={tester.name}>
              <td>{tester.name}</td>
              <td>{tester.version}</td>
              <td>{tester.row}</td>
              <td>{tester.notes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function NotesPanel(props: { notes: NoteData[] }): JSX.Element {
  return (
    <section className="panel" aria-label="Row notes">
      <h2>Row notes</h2>
      <ul className="panel-list" role="list" aria-label="Row notes">
        {props.notes.map((note, index) => (
          <li key={index}>{`Row ${note.row}: ${note.text} (${note.tester})`}</li>
        ))}
      </ul>
    </section>
  );
}
