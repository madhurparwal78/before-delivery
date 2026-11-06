import type { CommitResponse, RunDto, RunGridEntry } from '../../shared/api';
import { api, RequestFailed } from '../api';
import { copy } from '../copy';
import { el, openDialog, replace } from '../dom';
import type { ScreenContext, ScreenHandle } from '../main';
import { button, formAlert, labelledField, liveRegion, setFieldError } from '../ui';
import { createEventShell } from './eventShell';

const RAW_TIME_PATTERN = /^\d{2,3}\.\d{3}$/;

interface Draft {
  time: string;
  cones: string;
}

type Column =
  | { kind: 'car' }
  | { kind: 'class' }
  | { kind: 'driver' }
  | { kind: 'time'; runNumber: number }
  | { kind: 'cones'; runNumber: number };

function columnsFor(runsPerDriver: number): Column[] {
  const columns: Column[] = [{ kind: 'car' }, { kind: 'class' }, { kind: 'driver' }];
  for (let runNumber = 1; runNumber <= runsPerDriver; runNumber += 1) {
    columns.push({ kind: 'time', runNumber }, { kind: 'cones', runNumber });
  }
  return columns;
}

function timeCellText(run: RunDto, draft: Draft | undefined): string {
  if (draft && draft.time.length > 0) return draft.time;
  if (run.status === 'rerun_granted') return 'RRN';
  if (run.outcome === 'dnf') return 'DNF';
  if (run.rawTime !== null) return run.rawTime;
  return '';
}

function conesCellText(run: RunDto, draft: Draft | undefined): string {
  if (draft && draft.cones.length > 0) return draft.cones;
  if (run.outcome === 'time' && run.cones !== null) return String(run.cones);
  return '';
}

export function renderTiming(ctx: ScreenContext): ScreenHandle {
  const shell = createEventShell(ctx, 'timing');
  const announcements = liveRegion('Timing announcements');
  const grid = el('div', { class: 'run-grid', attrs: { role: 'grid', 'aria-label': 'Run grid' } });
  const headerRow = el('div', { class: 'run-grid__header', attrs: { 'aria-hidden': 'true' } });
  const gridScroller = el('div', { class: 'run-grid__scroller' }, headerRow, grid);
  const heatSelect = el('select', {
    class: 'field__input',
    attrs: { 'aria-label': 'Running heat', id: 'running-heat' },
  });

  replace(
    shell.content,
    el(
      'div',
      { class: 'timing' },
      el('h1', { class: 'page-heading', text: 'Timing' }),
      el(
        'div',
        { class: 'field field--inline' },
        el('label', { class: 'field__label', text: 'Running heat', attrs: { for: 'running-heat' } }),
        heatSelect,
      ),
      announcements,
      gridScroller,
    ),
  );

  let entries: RunGridEntry[] = [];
  let runsPerDriver = 1;
  let selectedHeat = 1;
  let columns: Column[] = columnsFor(1);
  let active = { row: 0, column: 3 };
  const drafts = new Map<string, Draft>();
  const cellNodes: HTMLElement[][] = [];

  const draftKey = (registrationId: string, runNumber: number): string =>
    `${registrationId}:${runNumber}`;

  function draftFor(registrationId: string, runNumber: number): Draft {
    const key = draftKey(registrationId, runNumber);
    const existing = drafts.get(key);
    if (existing) return existing;
    const created = { time: '', cones: '' };
    drafts.set(key, created);
    return created;
  }

  function paintHeader(): void {
    replace(
      headerRow,
      columns.map((column) =>
        el('span', {
          class: `run-grid__head run-grid__head--${column.kind}`,
          text:
            column.kind === 'car'
              ? 'Car'
              : column.kind === 'class'
                ? 'Class'
                : column.kind === 'driver'
                  ? 'Driver'
                  : column.kind === 'time'
                    ? `Run ${column.runNumber} time`
                    : `Run ${column.runNumber} cones`,
        }),
      ),
    );
  }

  function paintGrid(): void {
    cellNodes.length = 0;
    replace(grid);
    entries.forEach((entry, rowIndex) => {
      const row = el('div', { class: 'run-grid__row', attrs: { role: 'row' } });
      const rowCells: HTMLElement[] = [];
      columns.forEach((column, columnIndex) => {
        const cell = buildCell(entry, column, rowIndex, columnIndex);
        rowCells.push(cell);
        row.appendChild(cell);
      });
      cellNodes.push(rowCells);
      grid.appendChild(row);
    });
    active = {
      row: Math.min(active.row, Math.max(0, cellNodes.length - 1)),
      column: Math.min(active.column, Math.max(0, columns.length - 1)),
    };
    applyActive();
  }

  function buildCell(
    entry: RunGridEntry,
    column: Column,
    rowIndex: number,
    columnIndex: number,
  ): HTMLElement {
    const common = {
      role: 'gridcell',
      tabindex: '-1',
    };
    const sync = {
      click: () => moveTo(rowIndex, columnIndex),
      focus: () => setActive(rowIndex, columnIndex),
    };
    if (column.kind === 'car' || column.kind === 'class' || column.kind === 'driver') {
      const text =
        column.kind === 'car'
          ? String(entry.carNumber)
          : column.kind === 'class'
            ? entry.classCode
            : entry.checkedIn
              ? entry.driverName
              : `${entry.driverName} — Not checked in`;
      return el('div', {
        class: `run-grid__cell run-grid__cell--${column.kind}${
          column.kind === 'car' ? ' mono' : ''
        }`,
        text,
        attrs: common,
        on: sync,
      });
    }

    const run = entry.runs.find((candidate) => candidate.runNumber === column.runNumber);
    if (!run) throw new Error('Run grid is missing a run slot');
    const draft = drafts.get(draftKey(entry.registrationId, column.runNumber));
    const label = `Car ${entry.carNumber} ${entry.classCode} run ${column.runNumber} ${
      column.kind === 'time' ? 'time' : 'cones'
    }`;
    const text = column.kind === 'time' ? timeCellText(run, draft) : conesCellText(run, draft);
    const recorded = run.status === 'committed' || run.status === 'corrected';
    return el('div', {
      class: [
        'run-grid__cell',
        `run-grid__cell--${column.kind}`,
        'mono',
        recorded ? 'run-grid__cell--recorded' : '',
        run.outcome === 'dnf' ? 'run-grid__cell--dnf' : '',
        column.kind === 'cones' && (run.cones ?? 0) > 0 ? 'run-grid__cell--penalty' : '',
      ]
        .filter((name) => name.length > 0)
        .join(' '),
      text,
      attrs: { ...common, 'aria-label': label },
      on: sync,
    });
  }

  function applyActive(): void {
    for (const row of cellNodes) {
      for (const cell of row) cell.setAttribute('tabindex', '-1');
    }
    const cell = cellNodes[active.row]?.[active.column];
    if (cell) cell.setAttribute('tabindex', '0');
  }

  function setActive(row: number, column: number): void {
    if (cellNodes.length === 0) return;
    active = {
      row: Math.max(0, Math.min(cellNodes.length - 1, row)),
      column: Math.max(0, Math.min(columns.length - 1, column)),
    };
    applyActive();
  }

  function moveTo(row: number, column: number): void {
    setActive(row, column);
    cellNodes[active.row]?.[active.column]?.focus();
  }

  function refreshCell(rowIndex: number, columnIndex: number): void {
    const entry = entries[rowIndex];
    const column = columns[columnIndex];
    const node = cellNodes[rowIndex]?.[columnIndex];
    if (!entry || !column || !node) return;
    if (column.kind !== 'time' && column.kind !== 'cones') return;
    const run = entry.runs.find((candidate) => candidate.runNumber === column.runNumber);
    if (!run) return;
    const draft = drafts.get(draftKey(entry.registrationId, column.runNumber));
    node.textContent = column.kind === 'time' ? timeCellText(run, draft) : conesCellText(run, draft);
  }

  function refreshRun(rowIndex: number, runNumber: number): void {
    columns.forEach((column, columnIndex) => {
      if ((column.kind === 'time' || column.kind === 'cones') && column.runNumber === runNumber) {
        refreshCell(rowIndex, columnIndex);
      }
    });
  }

  async function loadGrid(heat: number): Promise<void> {
    const result = await api.events.runs(shell.eventId, heat);
    entries = result.entries;
    paintGrid();
  }

  function announce(message: string): void {
    announcements.textContent = message;
  }

  async function commit(rowIndex: number, runNumber: number): Promise<void> {
    const entry = entries[rowIndex];
    if (!entry) return;
    const run = entry.runs.find((candidate) => candidate.runNumber === runNumber);
    if (!run) return;
    const draft = draftFor(entry.registrationId, runNumber);
    if (draft.time.length === 0) {
      announce(copy.timing.empty);
      return;
    }
    let payload:
      | { outcome: 'time'; rawTime: string; cones: number }
      | { outcome: 'dnf' }
      | { outcome: 'rerun' };
    if (draft.time === 'DNF') payload = { outcome: 'dnf' };
    else if (draft.time === 'RRN') payload = { outcome: 'rerun' };
    else if (RAW_TIME_PATTERN.test(draft.time)) {
      payload = {
        outcome: 'time',
        rawTime: draft.time,
        cones: draft.cones.length === 0 ? 0 : Number(draft.cones),
      };
    } else {
      announce(copy.timing.format);
      return;
    }

    const cells = columns
      .map((column, columnIndex) => ({ column, columnIndex }))
      .filter(
        (item) =>
          (item.column.kind === 'time' || item.column.kind === 'cones') &&
          item.column.runNumber === runNumber,
      )
      .map((item) => cellNodes[rowIndex]?.[item.columnIndex])
      .filter((node): node is HTMLElement => node !== undefined);
    for (const cell of cells) cell.classList.add('is-pending');

    try {
      const result = await api.registrations.commitRun(entry.registrationId, runNumber, payload);
      applyCommit(entry, runNumber, result);
      drafts.delete(draftKey(entry.registrationId, runNumber));
      refreshRun(rowIndex, runNumber);
      announce(commitSentence(entry, runNumber, result));
      const nextRow = Math.min(rowIndex + 1, entries.length - 1);
      const timeColumn = columns.findIndex(
        (column) => column.kind === 'time' && column.runNumber === runNumber,
      );
      moveTo(nextRow, timeColumn);
    } catch (error) {
      if (error instanceof RequestFailed) {
        announce(commitError(error, entry, runNumber));
      } else {
        throw error;
      }
    } finally {
      for (const cell of cells) cell.classList.remove('is-pending');
    }
  }

  function applyCommit(entry: RunGridEntry, runNumber: number, result: CommitResponse): void {
    const index = entry.runs.findIndex((candidate) => candidate.runNumber === runNumber);
    if (index >= 0) entry.runs[index] = result.run;
  }

  function commitSentence(
    entry: RunGridEntry,
    runNumber: number,
    result: CommitResponse,
  ): string {
    if (result.run.outcome === 'rerun') {
      return copy.timing.rerunGranted(entry.carNumber, entry.classCode, runNumber);
    }
    if (result.run.outcome === 'dnf') {
      if (result.entry.position === null || result.entry.classPosition === null) {
        return copy.timing.committedDnfNoTime(entry.carNumber, entry.classCode);
      }
      return copy.timing.committedDnfRanked(
        entry.carNumber,
        entry.classCode,
        result.entry.classPosition,
        result.entry.position,
      );
    }
    return copy.timing.committedTime(
      entry.carNumber,
      entry.classCode,
      result.run.indexedTime ?? '',
      result.entry.classPosition ?? 0,
      result.entry.position ?? 0,
    );
  }

  function commitError(error: RequestFailed, entry: RunGridEntry, runNumber: number): string {
    if (error.code === 'heat_not_running') {
      return copy.timing.heatNotRunning(entry.carNumber, entry.runHeat);
    }
    if (error.code === 'not_checked_in') return copy.timing.notCheckedIn(entry.carNumber);
    if (error.code === 'run_already_committed') {
      return copy.timing.alreadyRecorded(runNumber, entry.carNumber);
    }
    if (error.status === 422 && error.fields.rawTime) return copy.timing.format;
    return error.message;
  }

  function openCorrectionDialog(rowIndex: number, runNumber: number): void {
    const entry = entries[rowIndex];
    if (!entry) return;
    const run = entry.runs.find((candidate) => candidate.runNumber === runNumber);
    if (!run) return;
    const alert = formAlert();
    const timeRadio = el('input', {
      attrs: {
        type: 'radio',
        name: 'correction-outcome',
        id: 'correction-time',
        value: 'time',
        ...(run.outcome === 'time' ? { checked: 'checked' } : {}),
      },
    });
    const dnfRadio = el('input', {
      attrs: {
        type: 'radio',
        name: 'correction-outcome',
        id: 'correction-dnf',
        value: 'dnf',
        ...(run.outcome === 'dnf' ? { checked: 'checked' } : {}),
      },
    });
    const rawTime = labelledField({
      label: 'Raw time',
      id: 'correction-raw',
      value: run.rawTime ?? '',
    });
    const cones = labelledField({
      label: 'Cones',
      id: 'correction-cones',
      type: 'number',
      value: String(run.cones ?? 0),
      min: '0',
      max: '30',
      step: '1',
    });
    const reason = labelledField({ label: 'Reason', id: 'correction-reason' });

    const submit = async (close: () => void): Promise<void> => {
      setFieldError(reason.input, '');
      const coneCount = Number(cones.input.value) || 0;
      const payload = timeRadio.checked
        ? {
            outcome: 'time' as const,
            rawTime: rawTime.input.value.trim(),
            cones: coneCount,
            reason: reason.input.value.trim(),
          }
        : { outcome: 'dnf' as const, cones: coneCount, reason: reason.input.value.trim() };
      announce(copy.timing.correctionPending);
      try {
        const result = await api.runs.correct(run.id, payload);
        const index = entry.runs.findIndex((candidate) => candidate.runNumber === runNumber);
        if (index >= 0) entry.runs[index] = result.run;
        refreshRun(rowIndex, runNumber);
        announce(
          copy.timing.corrected(
            entry.carNumber,
            entry.classCode,
            runNumber,
            result.run.indexedTime,
            result.entry.classPosition ?? 0,
            result.entry.position ?? 0,
          ),
        );
        close();
      } catch (error) {
        if (!(error instanceof RequestFailed)) throw error;
        if (error.code === 'results_locked') {
          announce(copy.timing.locked);
          return;
        }
        if (error.fields.reason) {
          setFieldError(reason.input, copy.timing.reason);
          alert.fields([{ message: copy.timing.reason, focus: () => reason.input.focus() }]);
          announce(copy.timing.reason);
          return;
        }
        if (error.fields.values) {
          alert.fields([{ message: copy.timing.noChange, focus: () => rawTime.input.focus() }]);
          announce(copy.timing.noChange);
          return;
        }
        if (error.fields.rawTime) {
          setFieldError(rawTime.input, copy.timing.format);
          alert.fields([{ message: copy.timing.format, focus: () => rawTime.input.focus() }]);
          announce(copy.timing.format);
          return;
        }
        announce(error.message);
      }
    };

    openDialog({
      name: 'Correct run',
      heading: `Correct car ${entry.carNumber} ${entry.classCode} run ${runNumber}`,
      build: (close) => {
        const save = button('Save correction', {
          variant: 'primary',
          onClick: () => void submit(close),
        });
        return [
          alert.element,
          el(
            'fieldset',
            { class: 'radio-group' },
            el('legend', { text: 'Outcome' }),
            el(
              'div',
              { class: 'radio' },
              timeRadio,
              el('label', { text: 'Time', attrs: { for: 'correction-time' } }),
            ),
            el(
              'div',
              { class: 'radio' },
              dnfRadio,
              el('label', { text: 'DNF', attrs: { for: 'correction-dnf' } }),
            ),
          ),
          rawTime.wrapper,
          cones.wrapper,
          reason.wrapper,
          el('div', { class: 'dialog__actions' }, save, button('Cancel', { onClick: close })),
        ];
      },
    });

  }

  function onGridKeyDown(event: KeyboardEvent): void {
    const entry = entries[active.row];
    const column = columns[active.column];
    if (!entry || !column) return;
    const isValueCell = column.kind === 'time' || column.kind === 'cones';
    const run = isValueCell
      ? entry.runs.find((candidate) => candidate.runNumber === column.runNumber)
      : undefined;

    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        moveTo(active.row, active.column + 1);
        return;
      case 'ArrowLeft':
        event.preventDefault();
        moveTo(active.row, active.column - 1);
        return;
      case 'ArrowDown':
        event.preventDefault();
        moveTo(active.row + 1, active.column);
        return;
      case 'ArrowUp':
        event.preventDefault();
        moveTo(active.row - 1, active.column);
        return;
      case 'Home':
        event.preventDefault();
        moveTo(active.row, 0);
        return;
      case 'End':
        event.preventDefault();
        moveTo(active.row, columns.length - 1);
        return;
      default:
        break;
    }

    if (!isValueCell || !run) return;
    const recorded = run.status === 'committed' || run.status === 'corrected';

    if (event.key === 'Enter') {
      event.preventDefault();
      if (recorded) openCorrectionDialog(active.row, column.runNumber);
      else void commit(active.row, column.runNumber);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      drafts.delete(draftKey(entry.registrationId, column.runNumber));
      refreshRun(active.row, column.runNumber);
      return;
    }
    if (recorded) return;

    const draft = draftFor(entry.registrationId, column.runNumber);
    if (event.key === 'Backspace') {
      event.preventDefault();
      if (column.kind === 'time') draft.time = draft.time.slice(0, -1);
      else draft.cones = draft.cones.slice(0, -1);
      refreshRun(active.row, column.runNumber);
      return;
    }
    if (column.kind === 'time') {
      if (/^[dD]$/.test(event.key)) {
        event.preventDefault();
        draft.time = 'DNF';
        refreshRun(active.row, column.runNumber);
        return;
      }
      if (/^[rR]$/.test(event.key)) {
        event.preventDefault();
        draft.time = 'RRN';
        refreshRun(active.row, column.runNumber);
        return;
      }
      if (/^[0-9.]$/.test(event.key)) {
        event.preventDefault();
        if (draft.time === 'DNF' || draft.time === 'RRN') draft.time = '';
        draft.time = `${draft.time}${event.key}`.slice(0, 7);
        refreshRun(active.row, column.runNumber);
      }
      return;
    }
    if (/^[0-9]$/.test(event.key)) {
      event.preventDefault();
      draft.cones = `${draft.cones}${event.key}`.slice(0, 2);
      refreshRun(active.row, column.runNumber);
    }
  }

  grid.addEventListener('keydown', onGridKeyDown);

  function firstPendingTimeCell(): { row: number; column: number } | null {
    for (let rowIndex = 0; rowIndex < entries.length; rowIndex += 1) {
      const entry = entries[rowIndex];
      if (!entry) continue;
      for (const run of entry.runs) {
        if (run.status === 'pending' || run.status === 'rerun_granted') {
          const columnIndex = columns.findIndex(
            (column) => column.kind === 'time' && column.runNumber === run.runNumber,
          );
          if (columnIndex >= 0) return { row: rowIndex, column: columnIndex };
        }
      }
    }
    return null;
  }

  async function jumpToGrid(): Promise<void> {
    const event = shell.current();
    if (event?.runningHeat !== null && event?.runningHeat !== undefined) {
      if (selectedHeat !== event.runningHeat) {
        selectedHeat = event.runningHeat;
        heatSelect.value = String(selectedHeat);
        await loadGrid(selectedHeat);
      }
    }
    const target = firstPendingTimeCell();
    if (target) moveTo(target.row, target.column);
    else moveTo(active.row, active.column);
  }

  function onScreenKeyDown(event: KeyboardEvent): void {
    if (event.altKey && (event.key === 'g' || event.key === 'G')) {
      event.preventDefault();
      void jumpToGrid();
    }
  }

  shell.element.addEventListener('keydown', onScreenKeyDown);

  heatSelect.addEventListener('change', () => {
    selectedHeat = Number(heatSelect.value);
    void (async () => {
      try {
        await api.events.runningHeat(shell.eventId, selectedHeat);
        await shell.refreshEvent();
      } catch (error) {
        if (!(error instanceof RequestFailed)) throw error;
      }
      await loadGrid(selectedHeat);
    })();
  });

  let initialised = false;
  shell.onEvent((event) => {
    runsPerDriver = event.runsPerDriver;
    columns = columnsFor(runsPerDriver);
    paintHeader();
    const options = event.heats.map((heat) =>
      el('option', { text: `Heat ${heat.number}`, attrs: { value: heat.number } }),
    );
    if (heatSelect.options.length !== options.length) replace(heatSelect, options);
    if (!initialised) {
      initialised = true;
      selectedHeat = event.runningHeat ?? 1;
      heatSelect.value = String(selectedHeat);
      void loadGrid(selectedHeat);
    } else if (event.runningHeat !== null && String(event.runningHeat) !== heatSelect.value) {
      heatSelect.value = String(event.runningHeat);
    }
  });

  return {
    element: shell.element,
    destroy: () => {
      grid.removeEventListener('keydown', onGridKeyDown);
      shell.element.removeEventListener('keydown', onScreenKeyDown);
      shell.destroy();
    },
  };
}
