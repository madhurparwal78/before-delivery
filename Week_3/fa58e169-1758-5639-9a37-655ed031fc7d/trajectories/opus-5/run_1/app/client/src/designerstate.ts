import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NO_STITCH, symbolsFor } from '../../src/domain/symbols';
import type { Cell, ChartAnalysis, RepeatBox } from '../../src/domain/types';
import {
  api,
  ApiFailure,
  type CellEditResult,
  type NoteData,
  type PatternData,
  type RowData,
  type TesterData,
  type VersionData,
} from './api';
import { useApp, type LiveMessage } from './app';
import { analyse, cellKey, cellMap, chartOf, rowCheckText, twinMaps, type ChartShape } from './chartstate';
import type { Peer, Selection } from './components/chartgrid';
import type { EditingRow } from './components/instructions';

export interface CellValue {
  row: number;
  col: number;
  stitch: string;
  colour: string;
}

interface CellStep {
  row: number;
  col: number;
  before: { stitch: string; colour: string };
  after: { stitch: string; colour: string };
  rev: number;
}

export type Step =
  | { kind: 'cells'; cells: CellStep[] }
  | { kind: 'repeat'; box: RepeatBox }
  | { kind: 'expand'; box: RepeatBox };

export type LiftSource = { kind: 'token'; row: number; index: number } | { kind: 'row'; row: number } | null;

export interface Clip {
  rows: number;
  cols: number;
  cells: { dRow: number; dCol: number; stitch: string; colour: string }[];
}

const FLASH_MS = 600;
const STATIC_OUTLINE_MS = 2000;

export function useDesigner(id: string) {
  const { config, subscribe, account, reduceMotion, navigate, sendLive } = useApp();
  const limits = config?.limits;
  const colourLimits = useMemo(
    () => ({
      coloursPerRow: limits?.coloursPerRow ?? 2,
      maxFloat: limits?.maxFloat ?? 5,
    }),
    [limits?.coloursPerRow, limits?.maxFloat],
  );

  const [name, setName] = useState('');
  const [shape, setShape] = useState<ChartShape | null>(null);
  const [cells, setCells] = useState<Map<string, Cell>>(new Map());
  const [serverRows, setServerRows] = useState<RowData[]>([]);
  const [version, setVersion] = useState(0);
  const [role, setRole] = useState<'owner' | 'co-designer'>('owner');
  const [testers, setTesters] = useState<TesterData[]>([]);
  const [versions, setVersions] = useState<VersionData[]>([]);
  const [notes, setNotes] = useState<NoteData[]>([]);
  const [here, setHere] = useState<{ id: string; name: string }[]>([]);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [missing, setMissing] = useState(false);

  const [cursor, setCursor] = useState({ row: 1, col: 1 });
  const [selection, setSelection] = useState<Selection | null>(null);
  const cursorRef = useRef({ row: 1, col: 1 });
  const selectionRef = useRef<Selection | null>(null);
  const anchor = useRef<{ row: number; col: number } | null>(null);
  const [tool, setTool] = useState<'Paint' | 'Select'>('Paint');
  const [symbol, setSymbol] = useState('');
  const [colour, setColour] = useState('A');
  const [clip, setClip] = useState<Clip | null>(null);

  const [cellAnnouncement, setCellAnnouncement] = useState('');
  const [rowCheck, setRowCheck] = useState('');
  const [chartSync, setChartSync] = useState('');
  const [conflict, setConflict] = useState('');
  const [editing, setEditing] = useState<EditingRow | null>(null);
  const [flashes, setFlashes] = useState<Map<string, 'flash' | 'static'>>(new Map());
  const [pin, setPin] = useState<LiftSource>(null);
  const [hoverSource, setHoverSource] = useState<LiftSource>(null);
  const [focusSource, setFocusSource] = useState<LiftSource>(null);

  const pendingRevs = useRef(new Map<string, number>());
  const sending = useRef<Promise<unknown>>(Promise.resolve());
  const undoStack = useRef<Step[]>([]);
  const redoStack = useRef<Step[]>([]);
  const flashTimers = useRef(new Map<string, number>());
  const conflictTimer = useRef<number | null>(null);
  const cellsRef = useRef(cells);
  const rowsRef = useRef<RowData[]>([]);
  cellsRef.current = cells;

  const chart = useMemo(
    () => (shape ? chartOf(shape, cells) : null),
    [shape, cells],
  );
  const analysis: ChartAnalysis | null = useMemo(
    () => (chart ? analyse(chart, colourLimits) : null),
    [chart, colourLimits],
  );
  const twins = useMemo(
    () => (analysis ? twinMaps(analysis) : { cellToToken: new Map(), tokenCells: new Map() }),
    [analysis],
  );

  const placeCursor = useCallback((next: { row: number; col: number }) => {
    cursorRef.current = next;
    setCursor(next);
  }, []);

  const placeSelection = useCallback((next: Selection | null) => {
    selectionRef.current = next;
    setSelection(next);
  }, []);

  const take = useCallback((data: PatternData) => {
    setName(data.name);
    setShape({
      craft: data.craft,
      mode: data.mode,
      terms: data.terms,
      castOn: data.castOn,
      width: data.width,
      height: data.height,
      colours: data.colours,
      repeats: data.repeats,
    });
    setCells(cellMap(data.cells));
    rowsRef.current = data.rows;
    setServerRows(data.rows);
    setVersion(data.version);
    setTesters(data.testers);
    setRole((data as PatternData & { role?: 'owner' | 'co-designer' }).role ?? 'owner');
    setSymbol((current) => current || symbolsFor(data.craft)[0].key);
    setColour((current) =>
      data.colours.some((entry) => entry.letter === current) ? current : data.colours[0].letter,
    );
    pendingRevs.current.clear();
  }, []);

  const loadAll = useCallback(async () => {
    const data = await api.get<PatternData>(`/api/patterns/${id}`);
    take(data);
    const [versionList, noteList] = await Promise.all([
      api.get<{ versions: VersionData[] }>(`/api/patterns/${id}/versions`),
      api.get<{ notes: NoteData[] }>(`/api/patterns/${id}/notes`),
    ]);
    setVersions(versionList.versions);
    setNotes(noteList.notes);
  }, [id, take]);

  useEffect(() => {
    void (async () => {
      try {
        await loadAll();
      } catch (failure) {
        if (failure instanceof ApiFailure && failure.status === 404) setMissing(true);
        else setFailed(true);
      }
      setLoading(false);
    })();
  }, [loadAll]);

  useEffect(() => {
    if (account) setHere([{ id: account.id, name: account.name }]);
  }, [account]);

  const flash = useCallback(
    (keys: string[]) => {
      if (keys.length === 0) return;
      const mark = reduceMotion ? 'static' : 'flash';
      setFlashes((current) => {
        const next = new Map(current);
        for (const key of keys) next.set(key, mark);
        return next;
      });
      for (const key of keys) {
        const running = flashTimers.current.get(key);
        if (running) window.clearTimeout(running);
        const timer = window.setTimeout(
          () => {
            flashTimers.current.delete(key);
            setFlashes((current) => {
              const next = new Map(current);
              next.delete(key);
              return next;
            });
          },
          reduceMotion ? STATIC_OUTLINE_MS : FLASH_MS,
        );
        flashTimers.current.set(key, timer);
      }
    },
    [reduceMotion],
  );

  /** Takes the server's rows and reads out what changed about the row checks. */
  const applyRows = useCallback((rows: RowData[]) => {
    const text = rowCheckText(rowsRef.current, rows);
    if (text !== '') setRowCheck(text);
    rowsRef.current = rows;
    setServerRows(rows);
  }, []);

  const showConflict = useCallback(
    (lines: { row: number; col: number; by: string }[]) => {
      const sorted = [...lines].sort((a, b) => a.row - b.row || a.col - b.col);
      const shown = sorted
        .slice(0, 3)
        .map((entry) => `${entry.by} changed row ${entry.row}, column ${entry.col} first. Your change was not kept.`);
      if (sorted.length > 3) {
        const extra = sorted.length - 3;
        shown.push(extra === 1 ? 'and 1 more cell.' : `and ${extra} more cells.`);
      }
      setConflict(shown.join('\n'));
      if (conflictTimer.current) window.clearTimeout(conflictTimer.current);
      conflictTimer.current = window.setTimeout(
        () => setConflict(''),
        (limits?.noticeSeconds ?? 6) * 1000,
      );
    },
    [limits?.noticeSeconds],
  );

  const patchCells = useCallback((values: (CellValue & { rev: number })[]) => {
    setCells((current) => {
      const next = new Map(current);
      for (const value of values) {
        const key = cellKey(value.row, value.col);
        const old = next.get(key);
        next.set(key, {
          row: value.row,
          col: value.col,
          stitch: value.stitch,
          colour: value.colour,
          repeat: old?.repeat ?? null,
          rev: value.rev,
        });
      }
      return next;
    });
  }, []);

  const revFor = useCallback((row: number, col: number): number => {
    const key = cellKey(row, col);
    const pending = pendingRevs.current.get(key);
    if (pending !== undefined) return pending;
    return cellsRef.current.get(key)?.rev ?? 0;
  }, []);

  /** Sends one edit action: cells, with the revisions this person's earlier edits left. */
  const postCells = useCallback(
    async (
      values: (CellValue & { rev?: number })[],
      options: { undo?: boolean; record?: boolean } = {},
    ): Promise<CellEditResult | null> => {
      if (values.length === 0) return null;
      const payload = values.map((value) => ({
        row: value.row,
        col: value.col,
        stitch: value.stitch,
        colour: value.colour,
        rev: value.rev ?? revFor(value.row, value.col),
      }));
      for (const cell of payload) pendingRevs.current.set(cellKey(cell.row, cell.col), cell.rev + 1);
      const priors = new Map(
        payload.map((cell) => {
          const old = cellsRef.current.get(cellKey(cell.row, cell.col));
          return [cellKey(cell.row, cell.col), { stitch: old?.stitch ?? NO_STITCH, colour: old?.colour ?? 'A' }];
        }),
      );
      try {
        // Edits leave in the order they were made.
        const request = sending.current.then(() =>
          api.post<CellEditResult>(`/api/patterns/${id}/cells`, {
            opId: crypto.randomUUID(),
            cells: payload,
          }),
        );
        sending.current = request.catch(() => undefined);
        const result = await request;
        const applied = result.applied.map((entry) => {
          const asked = payload.find((cell) => cell.row === entry.row && cell.col === entry.col)!;
          return { ...asked, rev: entry.rev };
        });
        patchCells(applied);
        patchCells(result.conflicts.map((entry) => ({ ...entry })));
        for (const entry of [...result.applied, ...result.conflicts]) {
          pendingRevs.current.delete(cellKey(entry.row, entry.col));
        }
        applyRows(result.rows);
        flash(applied.map((cell) => cellKey(cell.row, cell.col)));
        if (result.conflicts.length > 0) {
          if (options.undo) {
            const count = result.conflicts.length;
            const by = [...result.conflicts].sort((a, b) => a.row - b.row || a.col - b.col)[0].by;
            setChartSync(
              count === 1
                ? `1 cell left as ${by} changed it.`
                : `${count} cells left as ${by} changed them.`,
            );
          } else {
            showConflict(result.conflicts);
          }
        }
        if (options.record !== false && applied.length > 0) {
          undoStack.current.push({
            kind: 'cells',
            cells: applied.map((cell) => ({
              row: cell.row,
              col: cell.col,
              before: priors.get(cellKey(cell.row, cell.col))!,
              after: { stitch: cell.stitch, colour: cell.colour },
              rev: cell.rev,
            })),
          });
          if (undoStack.current.length > (limits?.undoDepth ?? 100)) undoStack.current.shift();
          redoStack.current = [];
        }
        return result;
      } catch (failure) {
        for (const cell of payload) pendingRevs.current.delete(cellKey(cell.row, cell.col));
        if (failure instanceof ApiFailure && failure.status === 429) {
          setChartSync(failure.body.message ?? '');
        } else {
          setChartSync('That change was not saved. Try again.');
        }
        return null;
      }
    },
    [applyRows, flash, id, limits?.undoDepth, patchCells, revFor, showConflict],
  );

  useEffect(
    () =>
      subscribe((message: LiveMessage) => {
        if (message.kind === 'cells' && message.by !== account?.id) {
          const pushed = message.cells as (CellValue & { rev: number })[];
          patchCells(pushed);
          applyRows(message.rows as RowData[]);
          flash(pushed.map((cell) => cellKey(cell.row, cell.col)));
          setEditing((current) =>
            current && pushed.some((cell) => cell.row === current.row)
              ? { ...current, rowChanged: true }
              : current,
          );
        }
        if (message.kind === 'cursor' && message.by !== account?.id) {
          setPeers((current) => [
            ...current.filter((peer) => peer.name !== message.name),
            { row: Number(message.row), col: Number(message.col), name: String(message.name) },
          ]);
        }
        if (message.kind === 'presence') {
          setHere(message.people as { id: string; name: string }[]);
        }
        if (message.kind === 'chart') {
          void loadAll();
        }
        if (message.kind === 'version') {
          void api
            .get<{ versions: VersionData[] }>(`/api/patterns/${id}/versions`)
            .then((data) => {
              setVersions(data.versions);
              setVersion(data.versions.length);
            });
        }
        if (message.kind === 'testers') {
          setTesters(message.testers as TesterData[]);
        }
        if (message.kind === 'counter') {
          setTesters((current) =>
            current.map((tester) =>
              tester.id === message.userId
                ? { ...tester, row: Number(message.row), version: Number(message.version) }
                : tester,
            ),
          );
        }
        if (message.kind === 'note') {
          const note: NoteData = {
            row: Number(message.row),
            text: String(message.text),
            tester: String(message.tester),
            version: Number(message.version),
          };
          setNotes((current) => [...current, note].sort((a, b) => a.row - b.row));
          setServerRows((current) =>
            current.map((row) =>
              row.row === note.row ? { ...row, notes: (row.notes ?? 0) + 1 } : row,
            ),
          );
        }
      }),
    [account?.id, applyRows, flash, id, loadAll, patchCells, subscribe],
  );

  useEffect(() => {
    sendLive({ kind: 'cursor', row: cursor.row, col: cursor.col });
  }, [cursor.row, cursor.col, sendLive]);

  return {
    state: {
      id,
      name,
      shape,
      cells,
      serverRows,
      version,
      role,
      testers,
      versions,
      notes,
      here,
      peers,
      loading,
      failed,
      missing,
      cursor,
      selection,
      tool,
      symbol,
      colour,
      clip,
      cellAnnouncement,
      rowCheck,
      chartSync,
      conflict,
      editing,
      flashes,
      pin,
      hoverSource,
      focusSource,
      analysis,
      chart,
      twins,
      limits,
      reduceMotion,
      account,
    },
    actions: {
      setCursor: placeCursor,
      setSelection: placeSelection,
      cursorRef,
      selectionRef,
      setTool,
      setSymbol,
      setColour,
      setClip,
      setCellAnnouncement,
      setRowCheck,
      setChartSync,
      setConflict,
      setEditing,
      applyRows,
      setPin,
      setHoverSource,
      setFocusSource,
      setShape,
      setVersions,
      setVersion,
      setNotes,
      setTesters,
      postCells,
      loadAll,
      flash,
      navigate,
      anchor,
      undoStack,
      redoStack,
      pendingRevs,
    },
  };
}
