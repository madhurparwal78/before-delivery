import { useRef, useState } from 'react';
import { repeatBoxTextError } from '../../../src/domain/grammar';
import { CABLE, NO_STITCH, symbolByLetterKey, symbolsFor } from '../../../src/domain/symbols';
import { api, ApiFailure, type MirrorResult, type TextResult } from '../api';
import { useApp } from '../app';
import { cellKey, stitchName } from '../chartstate';
import { ChartGrid, type Selection } from '../components/chartgrid';
import { Glyph } from '../components/glyphs';
import { Instructions } from '../components/instructions';
import {
  ColourKeyPanel,
  ColourWarningsPanel,
  HereNowPanel,
  RepeatsPanel,
  RowErrorsPanel,
  RowNotesPanel,
  TestersPanel,
  VersionsPanel,
} from '../components/panels';
import { RadioGroup } from '../components/radiogroup';
import { useDesigner, type CellValue, type LiftSource } from '../designerstate';
import { Shell } from '../shell';

const TILES = ['tile-green', 'tile-rose', 'tile-tan', 'tile-butter', 'tile-blue', 'tile-lilac', 'tile-sage', 'tile-pink', 'tile-teal', 'tile-peri'];

type Tab = 'Chart' | 'Instructions' | 'Testers';

export function DesignerScreen({ id }: { id: string }): JSX.Element {
  const { layout } = useApp();
  const { state, actions } = useDesigner(id);
  const [tab, setTab] = useState<Tab>('Chart');
  const [publishError, setPublishError] = useState('');
  const [versionError, setVersionError] = useState('');
  const [colourError, setColourError] = useState('');
  const [testerError, setTesterError] = useState('');
  const [coDesignerError, setCoDesignerError] = useState('');
  const [busy, setBusy] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const stroke = useRef<Map<string, CellValue>>(new Map());
  const painting = useRef(false);
  const gridScroll = useRef<HTMLDivElement>(null);

  const { shape, analysis, cells, serverRows, cursor, selection } = state;
  const at = (): { row: number; col: number } => actions.cursorRef.current;
  const picked = (): Selection | null => actions.selectionRef.current;

  if (state.missing) {
    return (
      <Shell lead="This page is not here.">
        <h1>Not found.</h1>
      </Shell>
    );
  }
  if (state.failed) return <Shell lead="This page could not be loaded. Reload to try again." />;
  if (state.loading || !shape || !analysis) return <Shell lead="Loading..." />;

  const craft = shape.craft;
  const sideOf = (row: number): 'RS' | 'WS' | 'RND' =>
    shape.mode === 'round' ? 'RND' : row % 2 === 1 ? 'RS' : 'WS';
  const readingStep = (row: number): number => (sideOf(row) === 'WS' ? 1 : -1);
  const cellValue = (row: number, col: number): CellValue => {
    const cell = cells.get(cellKey(row, col));
    return { row, col, stitch: cell?.stitch ?? NO_STITCH, colour: cell?.colour ?? 'A' };
  };
  const selectedCells = (): CellValue[] => {
    const box = picked();
    if (!box) return [cellValue(at().row, at().col)];
    const list: CellValue[] = [];
    for (let row = box.fromRow; row <= box.toRow; row += 1) {
      for (let col = box.fromCol; col <= box.toCol; col += 1) list.push(cellValue(row, col));
    }
    return list;
  };
  const rowErrors = serverRows.flatMap((row) => row.errors.map((message) => ({ row: row.row, message })));
  const lines = new Map(serverRows.map((row) => [row.row, row.text]));

  const announce = (text: string): void => actions.setCellAnnouncement(text);
  const announceCell = (row: number, col: number): void => {
    const cell = cells.get(cellKey(row, col));
    if (!cell) return;
    const name = stitchName(craft, cell.stitch);
    const repeat = cell.repeat ? `, repeat ${cell.repeat}` : '';
    announce(`Row ${row}, column ${col}: ${name}, colour ${cell.colour}${repeat}.`);
  };

  const moveCursor = (row: number, col: number, announceMove = true): void => {
    const next = {
      row: Math.min(Math.max(row, 1), shape.height),
      col: Math.min(Math.max(col, 1), shape.width),
    };
    actions.setCursor(next);
    if (announceMove) announceCell(next.row, next.col);
  };

  const placeCells = async (values: CellValue[]): Promise<void> => {
    await actions.postCells(values);
  };

  const placeSymbol = async (key: string): Promise<void> => {
    const name = stitchName(craft, key);
    const place = at();
    if (picked()) {
      const values = selectedCells().map((cell) => ({ ...cell, stitch: key }));
      announce(`Placed ${name} at row ${place.row}, column ${place.col}.`);
      await placeCells(values);
      return;
    }
    if (key === CABLE) {
      const columns: number[] = [];
      for (let offset = 3; offset >= 0; offset -= 1) {
        const col = place.col - offset;
        if (col >= 1) columns.push(col);
      }
      announce(`Placed ${name} at row ${place.row}, column ${place.col}.`);
      const target = sideOf(place.row) === 'WS' ? place.col + 1 : place.col - 4;
      if (target >= 1 && target <= shape.width) actions.setCursor({ row: place.row, col: target });
      await placeCells(columns.map((col) => ({ ...cellValue(place.row, col), stitch: key })));
      return;
    }
    announce(`Placed ${name} at row ${place.row}, column ${place.col}.`);
    const next = place.col + readingStep(place.row);
    if (next >= 1 && next <= shape.width) actions.setCursor({ row: place.row, col: next });
    await placeCells([{ ...cellValue(place.row, place.col), stitch: key }]);
  };

  const setCellColour = async (letter: string): Promise<void> => {
    if (!shape.colours.some((entry) => entry.letter === letter)) return;
    await placeCells(selectedCells().map((cell) => ({ ...cell, colour: letter })));
  };

  const removeStitches = async (): Promise<void> => {
    const name = stitchName(craft, NO_STITCH);
    announce(`Placed ${name} at row ${at().row}, column ${at().col}.`);
    await placeCells(selectedCells().map((cell) => ({ ...cell, stitch: NO_STITCH })));
  };

  const copySelection = (cut: boolean): void => {
    const block = selectedCells();
    const baseRow = Math.min(...block.map((cell) => cell.row));
    const baseCol = Math.min(...block.map((cell) => cell.col));
    const rows = Math.max(...block.map((cell) => cell.row)) - baseRow + 1;
    const cols = Math.max(...block.map((cell) => cell.col)) - baseCol + 1;
    actions.setClip({
      rows,
      cols,
      cells: block.map((cell) => ({
        dRow: cell.row - baseRow,
        dCol: cell.col - baseCol,
        stitch: cell.stitch,
        colour: cell.colour,
      })),
    });
    if (cut) {
      void placeCells(block.map((cell) => ({ ...cell, stitch: NO_STITCH, colour: 'A' })));
    }
  };

  const paste = async (): Promise<void> => {
    const clip = state.clip;
    if (!clip) return;
    const values: CellValue[] = [];
    let dropped = 0;
    for (const cell of clip.cells) {
      const row = at().row + cell.dRow;
      const col = at().col + cell.dCol;
      if (row < 1 || row > shape.height || col < 1 || col > shape.width) {
        dropped += 1;
        continue;
      }
      values.push({ row, col, stitch: cell.stitch, colour: cell.colour });
    }
    const total = clip.cells.length;
    if (dropped === 0) {
      actions.setChartSync(total === 1 ? 'Pasted 1 cell.' : `Pasted ${total} cells.`);
    } else {
      actions.setChartSync(
        `Pasted ${values.length} of ${total} cells. ${dropped === 1 ? '1 was' : `${dropped} were`} past the edge.`,
      );
    }
    await placeCells(values);
  };

  const mirror = async (): Promise<void> => {
    const block = picked() ?? {
      fromRow: at().row,
      toRow: at().row,
      fromCol: at().col,
      toCol: at().col,
    };
    const priors = new Map(
      selectedCells().map((cell) => [
        cellKey(cell.row, cell.col),
        { stitch: cell.stitch, colour: cell.colour },
      ]),
    );
    try {
      const result = await api.post<MirrorResult>(`/api/patterns/${id}/mirror`, {
        opId: crypto.randomUUID(),
        ...block,
      });
      actions.applyRows(result.rows);
      actions.flash(result.applied.map((cell) => cellKey(cell.row, cell.col)));
      actions.undoStack.current.push({
        kind: 'cells',
        cells: result.applied.map((cell) => ({
          row: cell.row,
          col: cell.col,
          before: priors.get(cellKey(cell.row, cell.col)) ?? { stitch: NO_STITCH, colour: 'A' },
          after: { stitch: cell.stitch, colour: cell.colour },
          rev: cell.rev,
        })),
      });
      actions.redoStack.current = [];
      await actions.loadAll();
    } catch (failure) {
      if (failure instanceof ApiFailure) actions.setChartSync(failure.body.message ?? '');
    }
  };

  const addRepeat = async (): Promise<void> => {
    const block = picked() ?? {
      fromRow: at().row,
      toRow: at().row,
      fromCol: at().col,
      toCol: at().col,
    };
    try {
      const made = await api.post<{ id: string; times: number }>(`/api/patterns/${id}/repeats`, block);
      actions.undoStack.current.push({
        kind: 'repeat',
        box: { id: made.id, times: made.times, ...block },
      });
      actions.redoStack.current = [];
      await actions.loadAll();
    } catch (failure) {
      if (failure instanceof ApiFailure) actions.setChartSync(failure.body.message ?? '');
    }
  };

  const expandRepeat = async (boxId: string): Promise<void> => {
    const box = shape.repeats.find((entry) => entry.id === boxId);
    if (!box) return;
    try {
      const result = await api.post<{ added: number }>(`/api/patterns/${id}/repeats/${boxId}/expand`);
      actions.setChartSync(
        `Repeat ${boxId} expanded: ${result.added} ${result.added === 1 ? 'column' : 'columns'} added.`,
      );
      actions.undoStack.current.push({ kind: 'expand', box });
      actions.redoStack.current = [];
      await actions.loadAll();
    } catch (failure) {
      if (failure instanceof ApiFailure) actions.setChartSync(failure.body.message ?? '');
    }
  };

  const setRepeatTimes = async (boxId: string, times: number): Promise<void> => {
    try {
      await api.patch(`/api/patterns/${id}/repeats/${boxId}`, { times });
      await actions.loadAll();
    } catch (failure) {
      if (failure instanceof ApiFailure) actions.setChartSync(failure.body.message ?? '');
    }
  };

  const stepBack = async (): Promise<void> => {
    const step = actions.undoStack.current.pop();
    if (!step) return;
    if (step.kind === 'cells') {
      const result = await actions.postCells(
        step.cells.map((cell) => ({ row: cell.row, col: cell.col, ...cell.before, rev: cell.rev })),
        { undo: true, record: false },
      );
      for (const applied of result?.applied ?? []) {
        const entry = step.cells.find((cell) => cell.row === applied.row && cell.col === applied.col);
        if (entry) entry.rev = applied.rev;
      }
    } else if (step.kind === 'repeat') {
      await api.remove(`/api/patterns/${id}/repeats/${step.box.id}`);
      await actions.loadAll();
    } else {
      await api.post(`/api/patterns/${id}/repeats/undo-expand`, step.box);
      await actions.loadAll();
    }
    actions.redoStack.current.push(step);
  };

  const stepForward = async (): Promise<void> => {
    const step = actions.redoStack.current.pop();
    if (!step) return;
    if (step.kind === 'cells') {
      const result = await actions.postCells(
        step.cells.map((cell) => ({ row: cell.row, col: cell.col, ...cell.after, rev: cell.rev })),
        { record: false },
      );
      for (const applied of result?.applied ?? []) {
        const entry = step.cells.find((cell) => cell.row === applied.row && cell.col === applied.col);
        if (entry) entry.rev = applied.rev;
      }
    } else if (step.kind === 'repeat') {
      await api.post(`/api/patterns/${id}/repeats`, step.box);
      await actions.loadAll();
    } else {
      await api.post(`/api/patterns/${id}/repeats/${step.box.id}/expand`);
      await actions.loadAll();
    }
    actions.undoStack.current.push(step);
  };

  const openRowText = (row: number): void => {
    const boxError = state.chart ? repeatBoxTextError(state.chart, row) : null;
    actions.setEditing({
      row,
      text: lines.get(row) ?? '',
      error: boxError ?? '',
      position: null,
      rowChanged: false,
    });
  };

  const closeRowText = (): void => {
    const row = state.editing?.row;
    actions.setEditing(null);
    if (row === undefined) return;
    const button = document.querySelector<HTMLButtonElement>(
      `.row-card[data-row="${row}"] .line-button`,
    );
    button?.focus();
  };

  const applyRowText = async (): Promise<void> => {
    const editing = state.editing;
    if (!editing) return;
    const priors = new Map(
      serverRows.length > 0
        ? Array.from({ length: shape.width }, (_, index) => {
            const cell = cellValue(editing.row, index + 1);
            return [cellKey(cell.row, cell.col), { stitch: cell.stitch, colour: cell.colour }] as const;
          })
        : [],
    );
    try {
      const result = await api.post<TextResult>(`/api/patterns/${id}/text`, {
        row: editing.row,
        text: editing.text,
      });
      const changedKeys: string[] = [];
      const steps = [];
      for (const cell of result.cells) {
        const prior = priors.get(cellKey(cell.row, cell.col));
        if (prior && (prior.stitch !== cell.stitch || prior.colour !== cell.colour)) {
          changedKeys.push(cellKey(cell.row, cell.col));
          steps.push({
            row: cell.row,
            col: cell.col,
            before: prior,
            after: { stitch: cell.stitch, colour: cell.colour },
            rev: cell.rev,
          });
        }
      }
      actions.applyRows(result.rows);
      actions.setChartSync(
        `Row ${editing.row} updated: ${result.changed} ${result.changed === 1 ? 'cell' : 'cells'} changed.`,
      );
      if (steps.length > 0) {
        actions.undoStack.current.push({ kind: 'cells', cells: steps });
        actions.redoStack.current = [];
      }
      await actions.loadAll();
      actions.flash(changedKeys);
      closeRowText();
    } catch (failure) {
      if (failure instanceof ApiFailure) {
        actions.setEditing({
          ...editing,
          error: failure.body.message ?? '',
          position: failure.body.position ?? null,
        });
      }
    }
  };

  const liftSets = (source: LiftSource): { cells: string[]; tokens: string[] } => {
    if (!source) return { cells: [], tokens: [] };
    if (source.kind === 'row') {
      const row = analysis.rows.find((entry) => entry.row === source.row);
      if (!row) return { cells: [], tokens: [] };
      return {
        tokens: row.tokens.map((_, index) => `${source.row}:${index}`),
        cells: row.tokens.flatMap((token) => token.cells.map((cell) => cellKey(cell.row, cell.col))),
      };
    }
    const key = `${source.row}:${source.index}`;
    return { tokens: [key], cells: state.twins.tokenCells.get(key) ?? [] };
  };

  const active = state.hoverSource ?? state.focusSource;
  const activeSets = liftSets(active);
  const pinSets = liftSets(state.pin);
  const liftedCells = new Set([...activeSets.cells, ...pinSets.cells]);
  const liftedTokens = new Set([...activeSets.tokens, ...pinSets.tokens]);
  const pinnedCells = new Set(pinSets.cells);
  const pinnedTokens = new Set(pinSets.tokens);

  const tokenOfCell = (row: number, col: number): LiftSource => {
    const found = state.twins.cellToToken.get(cellKey(row, col));
    return found ? { kind: 'token', row: found.row, index: found.index } : null;
  };

  const samePin = (a: LiftSource, b: LiftSource): boolean =>
    JSON.stringify(a) === JSON.stringify(b);

  const pinSource = (source: LiftSource): void => {
    actions.setPin(samePin(state.pin, source) ? null : source);
  };

  const selectRange = (row: number, col: number): void => {
    const start = actions.anchor.current ?? { row: at().row, col: at().col };
    actions.anchor.current = start;
    actions.setSelection({
      fromRow: Math.min(start.row, row),
      toRow: Math.max(start.row, row),
      fromCol: Math.min(start.col, col),
      toCol: Math.max(start.col, col),
    });
  };

  const onGridKeys = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement;
    const inGrid = target.hasAttribute('data-col');
    const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
    if (typing) return;
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key;

    if (mod) {
      const lower = key.toLowerCase();
      if (lower === 'z') {
        event.preventDefault();
        void (event.shiftKey ? stepForward() : stepBack());
        return;
      }
      if (lower === 'y') {
        event.preventDefault();
        void stepForward();
        return;
      }
      if (!inGrid) return;
      if (lower === 'c') {
        event.preventDefault();
        copySelection(false);
        return;
      }
      if (lower === 'x') {
        event.preventDefault();
        copySelection(true);
        return;
      }
      if (lower === 'v') {
        event.preventDefault();
        void paste();
      }
      return;
    }

    if (key === 'm') {
      event.preventDefault();
      void mirror();
      return;
    }
    if (key === 'b') {
      event.preventDefault();
      void addRepeat();
      return;
    }
    if (!inGrid) return;

    if (key.startsWith('Arrow')) {
      event.preventDefault();
      const step =
        key === 'ArrowUp' ? [1, 0] : key === 'ArrowDown' ? [-1, 0] : key === 'ArrowLeft' ? [0, -1] : [0, 1];
      const row = Math.min(Math.max(at().row + step[0], 1), shape.height);
      const col = Math.min(Math.max(at().col + step[1], 1), shape.width);
      if (event.shiftKey) {
        selectRange(row, col);
        actions.setCursor({ row, col });
        announceCell(row, col);
      } else {
        actions.anchor.current = null;
        actions.setSelection(null);
        moveCursor(row, col);
      }
      return;
    }
    if (key === 'Escape') {
      event.preventDefault();
      actions.anchor.current = null;
      actions.setSelection(null);
      return;
    }
    if (key === 'Delete') {
      event.preventDefault();
      void removeStitches();
      return;
    }
    if (key === 'Enter') {
      event.preventDefault();
      pinSource(tokenOfCell(at().row, at().col));
      return;
    }
    if (/^[1-6]$/.test(key)) {
      event.preventDefault();
      void setCellColour(String.fromCharCode(64 + Number(key)));
      return;
    }
    if (/^[a-z]$/.test(key)) {
      const found = symbolByLetterKey(craft, key);
      if (!found) return;
      event.preventDefault();
      void placeSymbol(found.key);
    }
  };

  const onDragStart = (row: number, col: number): void => {
    painting.current = true;
    if (state.tool === 'Select') {
      actions.anchor.current = { row, col };
      actions.setSelection({ fromRow: row, toRow: row, fromCol: col, toCol: col });
      return;
    }
    actions.anchor.current = null;
    actions.setSelection(null);
    stroke.current = new Map();
    stroke.current.set(cellKey(row, col), {
      row,
      col,
      stitch: state.symbol,
      colour: state.colour,
    });
  };

  const onDragMove = (row: number, col: number): void => {
    if (!painting.current) return;
    if (state.tool === 'Select') {
      selectRange(row, col);
      actions.setCursor({ row, col });
      return;
    }
    stroke.current.set(cellKey(row, col), {
      row,
      col,
      stitch: state.symbol,
      colour: state.colour,
    });
  };

  const onDragEnd = (): void => {
    if (!painting.current) return;
    painting.current = false;
    if (state.tool === 'Select') {
      const box = picked();
      if (box) {
        const rows = box.toRow - box.fromRow + 1;
        const cols = box.toCol - box.fromCol + 1;
        actions.setChartSync(
          `Selected ${rows} ${rows === 1 ? 'row' : 'rows'} by ${cols} ${cols === 1 ? 'column' : 'columns'}.`,
        );
      }
      return;
    }
    const values = [...stroke.current.values()];
    stroke.current = new Map();
    if (values.length > 0) void placeCells(values);
  };

  const saveVersion = async (note: string): Promise<void> => {
    setBusy(true);
    try {
      const made = await api.post<{ version: number }>(`/api/patterns/${id}/versions`, { note });
      actions.setChartSync(`Version ${made.version} saved.`);
      setVersionError('');
      await actions.loadAll();
      const list = await api.get<{ versions: typeof state.versions }>(`/api/patterns/${id}/versions`);
      actions.setVersions(list.versions);
    } catch (failure) {
      if (failure instanceof ApiFailure) setVersionError(failure.body.message ?? '');
      throw failure;
    } finally {
      setBusy(false);
    }
  };

  const publish = async (): Promise<void> => {
    setBusy(true);
    try {
      const done = await api.post<{ version: number }>(`/api/patterns/${id}/publish`);
      setPublishError('');
      actions.setChartSync(`Published version ${done.version}.`);
    } catch (failure) {
      if (failure instanceof ApiFailure) setPublishError(failure.body.message ?? '');
    } finally {
      setBusy(false);
    }
  };

  const restore = async (version: number): Promise<void> => {
    setBusy(true);
    try {
      const done = await api.post<{ version: number; restoredFrom: number }>(
        `/api/patterns/${id}/versions/${version}/restore`,
      );
      actions.setChartSync(`Restored version ${done.restoredFrom} as version ${done.version}.`);
      actions.undoStack.current = [];
      actions.redoStack.current = [];
      await actions.loadAll();
      const list = await api.get<{ versions: typeof state.versions }>(`/api/patterns/${id}/versions`);
      actions.setVersions(list.versions);
    } finally {
      setBusy(false);
    }
  };

  const inviteTester = async (email: string): Promise<void> => {
    setBusy(true);
    try {
      await api.post(`/api/patterns/${id}/testers`, { email });
      setTesterError('');
      actions.setChartSync(`Invitation sent to ${email}.`);
    } catch (failure) {
      if (failure instanceof ApiFailure) setTesterError(failure.body.message ?? '');
    } finally {
      setBusy(false);
    }
  };

  const addCoDesigner = async (email: string): Promise<void> => {
    try {
      const mate = await api.post<{ name: string }>(`/api/patterns/${id}/co-designers`, { email });
      setCoDesignerError('');
      actions.setChartSync(`${mate.name} can now edit this pattern.`);
    } catch (failure) {
      if (failure instanceof ApiFailure) setCoDesignerError(failure.body.message ?? '');
    }
  };

  const addColour = async (colourName: string, hex: string): Promise<void> => {
    try {
      await api.post(`/api/patterns/${id}/colours`, { name: colourName, hex });
      setColourError('');
      await actions.loadAll();
    } catch (failure) {
      if (failure instanceof ApiFailure) setColourError(failure.body.message ?? '');
    }
  };

  const versionOptions = state.versions.map((entry) => String(entry.version));
  const latest = versionOptions[versionOptions.length - 1] ?? '';
  const secondLatest = versionOptions[versionOptions.length - 2] ?? latest;
  const fromValue = from === '' ? secondLatest : from;
  const toValue = to === '' ? latest : to;

  const gridRows = serverRows.map((row) => ({
    row: row.row,
    side: row.side,
    used: row.used,
    made: row.made,
    state: row.state,
    notes: row.notes,
  }));

  const chartRegion = (
    <section className="region chart-region" aria-label="Chart" onKeyDown={onGridKeys}>
      <div className="tool-bar">
        <RadioGroup
          name="Tool"
          value={state.tool}
          options={[
            { value: 'Paint', label: 'Paint' },
            { value: 'Select', label: 'Select' },
          ]}
          onChange={(value) => actions.setTool(value as 'Paint' | 'Select')}
        />
        <RadioGroup
          name="Symbols"
          value={state.symbol}
          options={symbolsFor(craft).map((entry, index) => ({
            value: entry.key,
            label: entry.name,
            tile: TILES[index % TILES.length],
            glyph: <Glyph stitch={entry.key} craft={craft} />,
          }))}
          onChange={actions.setSymbol}
        />
        <RadioGroup
          name="Colours"
          value={state.colour}
          options={shape.colours.map((entry) => ({
            value: entry.letter,
            label: `${entry.letter} ${entry.name}`,
            swatch: entry.hex,
          }))}
          onChange={actions.setColour}
        />
        <button type="button" onClick={() => void addRepeat()}>
          Add repeat
        </button>
        <button type="button" onClick={() => void mirror()}>
          Mirror
        </button>
      </div>
      <ChartGrid
        name="Stitch chart"
        shape={shape}
        cells={cells}
        rows={gridRows}
        cursor={cursor}
        selection={selection}
        peers={state.peers}
        lifted={liftedCells}
        pinned={pinnedCells}
        flashes={state.flashes}
        editable
        scrollRef={gridScroll}
        onCursor={(row, col) => actions.setCursor({ row, col })}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onCellHover={(cell) =>
          actions.setHoverSource(cell ? tokenOfCell(cell.row, cell.col) : null)
        }
        onCellFocus={(cell) =>
          actions.setFocusSource(cell ? tokenOfCell(cell.row, cell.col) : null)
        }
      />
    </section>
  );

  const instructionsRegion = (
    <section className="region instructions-region" aria-label="Instructions">
      <Instructions
        rows={analysis.rows}
        lines={lines}
        liftedTokens={liftedTokens}
        pinnedTokens={pinnedTokens}
        editable
        editing={state.editing}
        onTokenHover={(token) => actions.setHoverSource(token ? { kind: 'token', ...token } : null)}
        onTokenFocus={(token) => actions.setFocusSource(token ? { kind: 'token', ...token } : null)}
        onPinToken={(row, index) => pinSource({ kind: 'token', row, index })}
        onPinRow={(row) => pinSource({ kind: 'row', row })}
        onEdit={openRowText}
        onEditText={(text) =>
          actions.setEditing(state.editing ? { ...state.editing, text } : state.editing)
        }
        onApply={() => void applyRowText()}
        onCancelEdit={closeRowText}
      />
    </section>
  );

  const chartPanels = (
    <>
      <RepeatsPanel
        repeats={shape.repeats}
        onTimes={(boxId, times) => void setRepeatTimes(boxId, times)}
        onExpand={(boxId) => void expandRepeat(boxId)}
      />
      <ColourKeyPanel
        colours={shape.colours}
        error={colourError}
        onAdd={(colourName, hex) => void addColour(colourName, hex)}
      />
      <RowErrorsPanel
        errors={rowErrors}
        onGo={(row) => {
          actions.setSelection(null);
          moveCursor(row, 1);
          document
            .querySelector<HTMLElement>(`[data-row="${row}"][data-col="1"]`)
            ?.focus();
        }}
      />
      <ColourWarningsPanel warnings={analysis.colourWarnings} />
      <HereNowPanel people={state.here} me={state.account?.id ?? ''} />
    </>
  );

  const testerPanels = (
    <>
      <VersionsPanel
        versions={state.versions}
        publishError={publishError}
        versionError={versionError}
        busy={busy}
        from={fromValue}
        to={toValue}
        onFrom={setFrom}
        onTo={setTo}
        onCompare={() => actions.navigate(`/patterns/${id}/compare?a=${fromValue}&b=${toValue}`)}
        onSaveVersion={saveVersion}
        onPublish={() => void publish()}
        onRestore={restore}
      />
      <TestersPanel
        testers={state.testers}
        testerError={testerError}
        coDesignerError={coDesignerError}
        owner={state.role === 'owner'}
        busy={busy}
        onInvite={(email) => void inviteTester(email)}
        onCoDesigner={(email) => void addCoDesigner(email)}
      />
      <RowNotesPanel notes={state.notes} />
    </>
  );

  const tabs: Tab[] = ['Chart', 'Instructions', 'Testers'];

  return (
    <Shell
      wide
      lead={rowErrors.length > 0 ? rowErrors[0].message : 'All rows check out.'}
      panelLinks={[
        { label: 'Chart', onActivate: () => setTab('Chart') },
        { label: 'Instructions', onActivate: () => setTab('Instructions') },
        { label: 'Versions', onActivate: () => setTab('Testers') },
        { label: 'Testers', onActivate: () => setTab('Testers') },
        { label: 'Row notes', onActivate: () => setTab('Testers') },
      ]}
    >
      <h1 className="pattern-title">{state.name}</h1>
      {layout === 'desktop' ? (
        <div className="designer-desktop">
          <div className="designer-top">
            {chartRegion}
            {instructionsRegion}
          </div>
          <div className="designer-panels">
            {chartPanels}
            {testerPanels}
          </div>
        </div>
      ) : (
        <>
          <div role="tablist" aria-label="Pattern" className="tab-row">
            {tabs.map((entry) => (
              <button
                type="button"
                key={entry}
                role="tab"
                id={`tab-${entry}`}
                aria-selected={tab === entry}
                aria-controls={`panel-${entry}`}
                tabIndex={tab === entry ? 0 : -1}
                className={tab === entry ? 'tab chosen' : 'tab'}
                onClick={() => setTab(entry)}
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                  event.preventDefault();
                  const at = tabs.indexOf(tab);
                  const next = tabs[(at + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
                  setTab(next);
                  document.getElementById(`tab-${next}`)?.focus();
                }}
              >
                {entry}
              </button>
            ))}
          </div>
          <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
            {tab === 'Chart' ? (
              <>
                {chartRegion}
                {chartPanels}
              </>
            ) : null}
            {tab === 'Instructions' ? instructionsRegion : null}
            {tab === 'Testers' ? testerPanels : null}
          </div>
        </>
      )}
      <div className="live-lines">
        <p role="status" aria-label="Cell announcement" className="status-line">
          {state.cellAnnouncement}
        </p>
        <p role="status" aria-label="Row check" className="status-line">
          {state.rowCheck}
        </p>
        <p role="status" aria-label="Chart sync" className="status-line">
          {state.chartSync}
        </p>
        <p role="alert" aria-label="Conflict" className="alert">
          {state.conflict.split('\n').map((line, index) => (
            <span key={index} className="conflict-line">
              {line}
            </span>
          ))}
        </p>
      </div>
    </Shell>
  );
}

