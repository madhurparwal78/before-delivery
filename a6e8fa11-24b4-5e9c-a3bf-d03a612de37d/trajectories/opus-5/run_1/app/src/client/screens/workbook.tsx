import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ConflictDto,
  ExportDto,
  SessionUser,
  ShareLinkDto,
  VersionDto,
} from '../../shared/api';
import { chartData } from '../../shared/charts';
import { SEASON_LABELS, SEASON_WORDS, SeasonAction } from '../../shared/season';
import { canEditCells, canEditStructure, roleCan } from '../../shared/roles';
import { cellKey, formatCellRef, formatRangeRef, parseRangeRef, qualifiedRange, splitQualified } from '../../shared/refs';
import { NUMBER_FORMATS, NumberFormat } from '../../shared/values';
import { ChartType } from '../../shared/workbook';
import { LIMITS } from '../../shared/limits';
import { ApiFailure, api, newUuid } from '../lib/api';
import {
  CHART_RANGE_ERROR,
  CHART_TITLE_ERROR,
  CUTOFF_FORMAT_ERROR,
  READ_ONLY_NOTICE,
  SHEET_NAME_ERROR,
  VERSION_LABEL_ERROR,
  VERSION_STORAGE_ERROR,
  stamp,
} from '../lib/copy';
import { notify } from '../lib/notices';
import { WorkbookStore, reducedMotion } from '../lib/store';
import { chartRangeIsValid, sheetNameIsValid } from '../../shared/ops';
import { Dialog, FieldError, NotFoundScreen } from '../components/shell';
import { Grid, GridSelection } from '../components/grid';
import { Rail, RailTab } from '../components/rail';

const FORMAT_LABELS: Record<NumberFormat, string> = {
  general: 'General',
  '0': '0',
  '0.0': '0.0',
  '0.00': '0.00',
  '0.000': '0.000',
  '0.0%': '0.0%',
  date: 'Date',
};

const SEASON_ITEMS: { action: SeasonAction | 'cutoff'; label: string }[] = [
  { action: 'start', label: 'Start season' },
  { action: 'cutoff', label: 'Set cutoff…' },
  { action: 'close', label: 'Close season now' },
  { action: 'reopen', label: 'Reopen season…' },
  { action: 'archive', label: 'Archive workbook' },
];

function localStampToApi(text: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(text.trim());
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}`;
}

function apiStampToLocal(text: string | null): string {
  if (!text) return '';
  return text.replace('T', ' ').slice(0, 16);
}

interface WorkbookScreenProps {
  workbookId: string;
  user: SessionUser;
}

export function WorkbookScreen({ workbookId, user }: WorkbookScreenProps): JSX.Element {
  const store = useMemo(() => new WorkbookStore(workbookId, user), [workbookId, user.id]);
  const [, setVersion] = useState(0);
  useEffect(() => store.subscribe(() => setVersion((count) => count + 1)), [store]);
  useEffect(() => {
    void store.load();
    return () => store.dispose();
  }, [store]);

  useEffect(() => {
    const refresh = window.setInterval(() => {
      if (navigator.onLine) void store.load();
    }, 10000);
    const retry = window.setInterval(() => void store.sync(), 5000);
    const backOnline = () => {
      store.online = true;
      void store.sync();
    };
    const wentOffline = () => {
      store.online = false;
      setVersion((count) => count + 1);
    };
    window.addEventListener('online', backOnline);
    window.addEventListener('offline', wentOffline);
    return () => {
      window.clearInterval(refresh);
      window.clearInterval(retry);
      window.removeEventListener('online', backOnline);
      window.removeEventListener('offline', wentOffline);
    };
  }, [store]);

  const [sheetId, setSheetId] = useState<string | null>(null);
  const [selection, setSelection] = useState<GridSelection>({
    anchor: { col: 1, row: 1 },
    focus: { col: 1, row: 1 },
  });
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [formulaValue, setFormulaValue] = useState('');
  const [railOpen, setRailOpen] = useState(window.innerWidth >= 1280);
  const [railTab, setRailTab] = useState<RailTab>('Conflicts');
  const [conflictFocusToken, setConflictFocusToken] = useState(0);
  const [resolvingConflict, setResolvingConflict] = useState<string | null>(null);
  const [seasonMenuOpen, setSeasonMenuOpen] = useState(false);
  const [cutoffDialog, setCutoffDialog] = useState<'cutoff' | 'reopen' | null>(null);
  const [sheetDialog, setSheetDialog] = useState<{ mode: 'add' | 'rename'; sheetId?: string } | null>(null);
  const [exportDialog, setExportDialog] = useState(false);
  const [shareDialog, setShareDialog] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<VersionDto | null>(null);
  const [versions, setVersions] = useState<VersionDto[]>([]);
  const [versionLabel, setVersionLabel] = useState('');
  const [versionSaving, setVersionSaving] = useState(false);
  const [versionError, setVersionError] = useState<string | null>(null);
  const [chartRange, setChartRange] = useState('');
  const [chartTitle, setChartTitle] = useState('');
  const [chartType, setChartType] = useState<ChartType>('bar');
  const [chartRangeError, setChartRangeError] = useState<string | null>(null);
  const [chartTitleError, setChartTitleError] = useState<string | null>(null);

  const gridRef = useRef<HTMLDivElement | null>(null);
  const formulaRef = useRef<HTMLInputElement | null>(null);
  const sheetTabsRef = useRef<HTMLDivElement | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  const seasonButtonRef = useRef<HTMLButtonElement | null>(null);

  const snapshot = store.snapshot;
  const sheets = snapshot?.sheets ?? [];
  const currentSheet = sheets.find((sheet) => sheet.id === sheetId) ?? sheets[0];

  useEffect(() => {
    if (currentSheet && currentSheet.id !== sheetId) setSheetId(currentSheet.id);
  }, [currentSheet?.id]);

  const activeRef = formatCellRef(selection.focus);
  const activeCell = currentSheet && store.evaluation ? store.evaluation.cell(currentSheet.id, activeRef) : undefined;

  useEffect(() => {
    setFormulaValue(activeCell?.input ?? '');
  }, [activeRef, currentSheet?.id, activeCell?.input]);

  const canEdit = snapshot ? canEditCells(snapshot.myRole, snapshot.state) : false;
  const canStructure = snapshot ? canEditStructure(snapshot.myRole, snapshot.state) : false;
  const isManager = snapshot?.myRole === 'data_manager';
  const canSeason = snapshot ? roleCan(snapshot.myRole, 'seasonManage') : false;
  const canExports = snapshot ? roleCan(snapshot.myRole, 'exports') : false;
  const canVersions = snapshot ? roleCan(snapshot.myRole, 'versions') : false;

  const railTabs: RailTab[] = canVersions
    ? ['Conflicts', 'Charts', 'Changed cells', 'Versions']
    : ['Conflicts', 'Charts', 'Changed cells'];

  const readOnlyAttempt = useCallback(() => notify(READ_ONLY_NOTICE), []);

  const commitCell = (ref: string, input: string, move: 'down' | 'right' | 'left' | 'none') => {
    if (!currentSheet) return;
    setEditing(null);
    const current = store.evaluation?.cell(currentSheet.id, ref)?.input ?? '';
    if (input !== current) {
      store.commit(
        { opId: newUuid(), type: 'setCell', sheetId: currentSheet.id, cell: ref, input },
        { furrow: { sheetId: currentSheet.id, cell: ref } },
      );
      if (reducedMotion()) {
        setRailOpen(true);
        setRailTab('Changed cells');
      }
    }
    if (move === 'down') setSelection(({ focus }) => shift(focus, 0, 1));
    if (move === 'right') setSelection(({ focus }) => shift(focus, 1, 0));
    if (move === 'left') setSelection(({ focus }) => shift(focus, -1, 0));
    gridRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
  };

  const shift = (focus: { col: number; row: number }, dc: number, dr: number): GridSelection => {
    const next = {
      col: Math.min(LIMITS.maxColumns, Math.max(1, focus.col + dc)),
      row: Math.min(LIMITS.maxRows, Math.max(1, focus.row + dr)),
    };
    return { anchor: next, focus: next };
  };

  const selectionRange = () => selectionRangeText(selection);

  const applyFormat = (format: { numberFormat?: NumberFormat; bold?: boolean }) => {
    if (!currentSheet || !canEdit) {
      readOnlyAttempt();
      return;
    }
    store.commit({
      opId: newUuid(),
      type: 'setFormat',
      sheetId: currentSheet.id,
      range: selectionRange(),
      format,
    });
  };

  const toggleBold = () => {
    if (!currentSheet || !store.evaluation) return;
    const range = parseRangeRef(selectionRange());
    if (!range) return;
    let anyNotBold = false;
    for (let row = range.startRow; row <= range.endRow; row++) {
      for (let col = range.startCol; col <= range.endCol; col++) {
        const cell = store.evaluation.cell(currentSheet.id, formatCellRef({ col, row }));
        if (!cell || !cell.bold) anyNotBold = true;
      }
    }
    applyFormat({ bold: anyNotBold });
  };

  const switchSheet = (delta: number) => {
    if (!currentSheet) return;
    const index = sheets.findIndex((sheet) => sheet.id === currentSheet.id);
    const next = sheets[(index + delta + sheets.length) % sheets.length];
    if (next) {
      setSheetId(next.id);
      store.clearBadges();
    }
  };

  const seasonAction = async (action: SeasonAction, closesAt?: string | null) => {
    try {
      const body: Record<string, unknown> = { action };
      if (action === 'reopen') body.closesAt = closesAt ?? null;
      await api(`/api/workbooks/${workbookId}/season`, { method: 'POST', body });
      notify(
        action === 'start'
          ? 'Season started.'
          : action === 'close'
            ? 'Season closed.'
            : action === 'reopen'
              ? 'Season reopened.'
              : 'Workbook archived.',
      );
      await store.load();
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.status === 409) {
        notify(`That isn't allowed while the workbook is ${SEASON_WORDS[snapshot?.state ?? 'draft']}.`);
      } else if (failure instanceof ApiFailure) {
        notify(Object.values(failure.fields)[0] ?? failure.text);
      }
    }
  };

  const setCutoff = async (text: string) => {
    const trimmed = text.trim();
    if (trimmed !== '' && localStampToApi(trimmed) === null) {
      notify(CUTOFF_FORMAT_ERROR);
      return false;
    }
    try {
      const result = await api<{ workbook: { closesAtUtc: string | null } }>(`/api/workbooks/${workbookId}`, {
        method: 'PATCH',
        body: { closesAt: trimmed === '' ? null : localStampToApi(trimmed) },
      });
      notify(
        result.workbook.closesAtUtc
          ? `Cutoff set to ${stamp(result.workbook.closesAtUtc, store.timeZone)}.`
          : 'Cutoff cleared.',
      );
      await store.load();
      return true;
    } catch (failure) {
      if (failure instanceof ApiFailure) {
        notify(Object.values(failure.fields)[0] ?? failure.text);
      }
      return false;
    }
  };

  const loadVersions = useCallback(async () => {
    if (!canVersions) return;
    try {
      const result = await api<{ versions: VersionDto[] }>(`/api/workbooks/${workbookId}/versions`);
      setVersions(result.versions);
    } catch {
      /* versions stay as they were */
    }
  }, [canVersions, workbookId]);

  useEffect(() => {
    if (railTab === 'Versions') void loadVersions();
  }, [railTab, loadVersions]);

  // Opening the chart builder fills the range field from the current selection.
  useEffect(() => {
    if (railTab === 'Charts' && currentSheet) {
      setChartRange(qualifiedRange(currentSheet.name, selectionRangeText(selection)));
    }
  }, [railTab, currentSheet?.id]);

  const saveVersion = async () => {
    const label = versionLabel.trim();
    if (label.length < 1 || label.length > 60) {
      setVersionError(VERSION_LABEL_ERROR);
      return;
    }
    setVersionError(null);
    setVersionSaving(true);
    try {
      const result = await api<{ version: VersionDto }>(`/api/workbooks/${workbookId}/versions`, {
        method: 'POST',
        body: { label },
      });
      notify(`Version ${result.version.number} saved.`);
      setVersionLabel('');
      await loadVersions();
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.status === 503) notify(VERSION_STORAGE_ERROR);
      else if (failure instanceof ApiFailure) setVersionError(Object.values(failure.fields)[0] ?? failure.text);
    } finally {
      setVersionSaving(false);
    }
  };

  const runRestore = async (version: VersionDto, undoOf: VersionDto | null = null) => {
    try {
      const result = await api<{ restored: VersionDto; undo: VersionDto }>(
        `/api/workbooks/${workbookId}/versions/${version.id}/restore`,
        { method: 'POST' },
      );
      await store.load();
      await loadVersions();
      if (undoOf) {
        notify(`Restore undone as version ${result.restored.number}.`);
      } else {
        notify(
          `Restored version ${version.number} as version ${result.restored.number}.`,
          { label: 'Undo restore', run: () => void runRestore(result.undo, version) },
          10000,
        );
      }
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.status === 503) notify(VERSION_STORAGE_ERROR);
      else if (failure instanceof ApiFailure && failure.status === 409) {
        notify(`That isn't allowed while the workbook is ${SEASON_WORDS[snapshot?.state ?? 'locked']}.`);
      }
    }
  };

  const addChart = () => {
    if (!currentSheet || !store.state) return;
    const typed = chartRange.trim();
    const split = splitQualified(typed);
    const qualified =
      split && split.sheetName === null ? qualifiedRange(currentSheet.name, split.rest.toUpperCase()) : typed;
    const title = chartTitle.trim();
    const op = {
      opId: newUuid(),
      type: 'addChart' as const,
      chartId: newUuid(),
      sheetId: currentSheet.id,
      chartType,
      title,
      range: qualified,
    };
    const titleOk = title.length >= 1 && title.length <= 60;
    setChartTitleError(titleOk ? null : CHART_TITLE_ERROR);
    const rangeOk = titleOk && chartRangeIsValid(op, store.state);
    setChartRangeError(rangeOk || !titleOk ? null : CHART_RANGE_ERROR);
    if (!titleOk || !rangeOk) return;
    store.commit(op);
    setChartTitle('');
  };

  if (store.notFound) return <NotFoundScreen />;
  if (!snapshot || !currentSheet || !store.state || !store.evaluation) {
    return (
      <main className="workbook-screen">
        <p className="muted">Opening workbook…</p>
      </main>
    );
  }

  const workbookState = store.state;
  const evaluation = store.evaluation;
  const openConflicts = store.conflicts;
  const chartsOfSheet = workbookState.charts.filter((chart) => chart.sheetId === currentSheet.id);
  const furrowAdjusted = (sheetIdOfChart: string, ref: string): number | null => {
    const entry = store.furrowEntries.find(
      (candidate) => candidate.sheetId === sheetIdOfChart && candidate.ref === ref,
    );
    if (entry && !store.furrowLanded.has(cellKey(sheetIdOfChart, ref))) return entry.fromValue;
    const value = store.evaluation?.valueAt(sheetIdOfChart, ref);
    return typeof value === 'number' ? value : null;
  };

  const chartProps = chartsOfSheet.map((chart) => {
    const data = chartData(chart, workbookState, evaluation);
    const range = parseRangeRef(chart.range);
    const series = data.series.map((one, seriesIndex) => ({
      name: one.name,
      values: one.values.map((value, index) => {
        if (!range) return value;
        const ref = formatCellRef({
          col: range.startCol + 1 + seriesIndex,
          row: range.startRow + 1 + index,
        });
        return furrowAdjusted(chart.sheetId, ref) ?? value;
      }),
    }));
    return {
      title: chart.title,
      type: chart.chartType,
      categories: data.categories,
      series,
      onRemove: canStructure
        ? () => store.commit({ opId: newUuid(), type: 'removeChart', chartId: chart.id })
        : undefined,
    };
  });

  const onRegionKey = (event: React.KeyboardEvent) => {
    if (event.key !== 'F6') return;
    event.preventDefault();
    const regions: (HTMLElement | null)[] = [
      formulaRef.current,
      gridRef.current?.querySelector<HTMLElement>('[aria-selected="true"]') ?? gridRef.current,
      sheetTabsRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') ?? null,
      railRef.current?.querySelector<HTMLElement>('[role="tab"]') ?? null,
    ];
    const index = regions.findIndex((region) => region && region.contains(document.activeElement));
    const step = event.shiftKey ? regions.length - 1 : 1;
    const next = (index < 0 ? 0 : index + step) % regions.length;
    if (next === 3) setRailOpen(true);
    window.setTimeout(() => regions[next]?.focus(), 0);
  };

  return (
    <main className="workbook-screen" onKeyDown={onRegionKey}>
      <div className="workbook-header">
        <h1>{snapshot.name}</h1>
        <span className={`season-chip ${snapshot.state}`} role="status" aria-label="Season state">
          {SEASON_LABELS[snapshot.state]}
        </span>
        <div className="header-actions">
          {canSeason || isManager ? (
            <div className="season-menu-wrap">
              <button
                type="button"
                className="ghost-button"
                ref={seasonButtonRef}
                aria-expanded={seasonMenuOpen}
                onClick={() => setSeasonMenuOpen((open) => !open)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    setSeasonMenuOpen(true);
                  }
                }}
              >
                Season
              </button>
              {seasonMenuOpen ? (
                <div
                  className="season-menu"
                  role="menu"
                  aria-label="Season"
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      setSeasonMenuOpen(false);
                      seasonButtonRef.current?.focus();
                    }
                    const items = [
                      ...(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []),
                    ];
                    const at = items.indexOf(document.activeElement as HTMLElement);
                    if (event.key === 'ArrowDown') {
                      event.preventDefault();
                      items[(at + 1) % items.length]?.focus();
                    }
                    if (event.key === 'ArrowUp') {
                      event.preventDefault();
                      items[(at - 1 + items.length) % items.length]?.focus();
                    }
                  }}
                  ref={(node) => {
                    node?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
                  }}
                >
                  {SEASON_ITEMS.map((item) => {
                    const enabled = seasonItemEnabled(item.action, snapshot.state, snapshot.myRole);
                    return (
                      <button
                        key={item.label}
                        type="button"
                        role="menuitem"
                        className="menu-item"
                        disabled={!enabled}
                        onClick={() => {
                          setSeasonMenuOpen(false);
                          if (item.action === 'cutoff') setCutoffDialog('cutoff');
                          else if (item.action === 'reopen') setCutoffDialog('reopen');
                          else void seasonAction(item.action);
                        }}
                      >
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ) : null}
          {canExports ? (
            <button type="button" className="ghost-button" onClick={() => setExportDialog(true)}>
              Export
            </button>
          ) : null}
          {isManager ? (
            <button type="button" className="ghost-button" onClick={() => setShareDialog(true)}>
              Share
            </button>
          ) : null}
          <button
            type="button"
            className="ghost-button"
            aria-expanded={railOpen}
            onClick={() => setRailOpen((open) => !open)}
          >
            Workbook rail
          </button>
        </div>
      </div>

      <div className="formula-bar">
        <div className="format-controls">
          <label className="inline-field">
            <span className="visually-hidden">Number format</span>
            <select
              aria-label="Number format"
              disabled={!canEdit}
              value={activeCell?.numberFormat ?? 'general'}
              onChange={(event) => applyFormat({ numberFormat: event.target.value as NumberFormat })}
            >
              {NUMBER_FORMATS.map((format) => (
                <option key={format} value={format}>
                  {FORMAT_LABELS[format]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="bold-button"
            aria-pressed={activeCell?.bold ?? false}
            disabled={!canEdit}
            onClick={toggleBold}
          >
            Bold
          </button>
        </div>
        <span className="active-ref numerals">{`${currentSheet.name}!${activeRef}`}</span>
        <label className="inline-field grow">
          <span className="visually-hidden">Formula</span>
          <input
            type="text"
            aria-label="Formula"
            ref={formulaRef}
            value={formulaValue}
            readOnly={!canEdit}
            onChange={(event) => setFormulaValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                if (!canEdit) {
                  readOnlyAttempt();
                  return;
                }
                commitCell(activeRef, formulaValue, 'none');
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                setFormulaValue(activeCell?.input ?? '');
                gridRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
              }
            }}
          />
        </label>
      </div>

      <div className="sync-strip">
        <span role="status" aria-label="Sync status" className="sync-status">
          {store.syncing ? <span className="sync-sweep" aria-hidden="true" /> : null}
          {store.syncStatusText()}
        </span>
        <button
          type="button"
          className="ghost-button small"
          onClick={() => {
            setRailOpen(true);
            setRailTab('Conflicts');
            setConflictFocusToken((token) => token + 1);
          }}
        >
          Conflicts ({openConflicts.length})
        </button>
      </div>

      <div className="workbook-body">
        <div className="grid-column">
          <Grid
            store={store}
            sheetId={currentSheet.id}
            sheetName={currentSheet.name}
            selection={selection}
            onSelect={setSelection}
            editing={editing}
            editValue={editValue}
            onEditValue={setEditValue}
            onStartEdit={(ref, value) => {
              setEditing(ref);
              setEditValue(value);
            }}
            onCommit={commitCell}
            onCancelEdit={() => {
              setEditing(null);
              gridRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
            }}
            onClear={(ref) => commitCell(ref, '', 'none')}
            onToggleBold={toggleBold}
            onSwitchSheet={switchSheet}
            onReadOnlyAttempt={readOnlyAttempt}
            canEdit={canEdit}
            gridRef={gridRef}
          />

          <div className="sheet-strip">
            <div
              className="sheet-tabs"
              role="tablist"
              aria-label="Sheets"
              ref={sheetTabsRef}
              onKeyDown={(event) => {
                const index = sheets.findIndex((sheet) => sheet.id === currentSheet.id);
                if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                  event.preventDefault();
                  switchSheet(event.key === 'ArrowRight' ? 1 : -1);
                  window.setTimeout(
                    () => sheetTabsRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus(),
                    0,
                  );
                }
                if (event.key === 'F2' && canStructure) {
                  event.preventDefault();
                  setSheetDialog({ mode: 'rename', sheetId: sheets[index]?.id });
                }
              }}
            >
              {sheets.map((sheet) => {
                const badge = sheet.id === currentSheet.id ? 0 : store.badgeFor(sheet.id);
                return (
                  <button
                    key={sheet.id}
                    type="button"
                    role="tab"
                    aria-selected={sheet.id === currentSheet.id}
                    tabIndex={sheet.id === currentSheet.id ? 0 : -1}
                    aria-describedby={badge > 0 ? `sheet-badge-${sheet.id}` : undefined}
                    className={`sheet-tab${sheet.id === currentSheet.id ? ' current' : ''}`}
                    onClick={() => {
                      setSheetId(sheet.id);
                      store.clearBadges();
                    }}
                    onDoubleClick={() => {
                      if (canStructure) setSheetDialog({ mode: 'rename', sheetId: sheet.id });
                    }}
                  >
                    {sheet.name}
                    {badge > 0 ? (
                      <>
                        <span className="tab-badge numerals" aria-hidden="true">
                          {badge}
                        </span>
                        <span id={`sheet-badge-${sheet.id}`} className="visually-hidden">
                          {badge} changed cells
                        </span>
                      </>
                    ) : null}
                  </button>
                );
              })}
            </div>
            {canStructure ? (
              <button type="button" className="ghost-button small" onClick={() => setSheetDialog({ mode: 'add' })}>
                Add sheet
              </button>
            ) : null}
          </div>
        </div>

        <div ref={railRef} className={railOpen ? 'rail-host open' : 'rail-host'}>
          <Rail
            store={store}
            open={railOpen}
            tab={railTab}
            tabs={railTabs}
            onTab={setRailTab}
            conflicts={openConflicts}
            resolving={resolvingConflict}
            onResolve={(conflict, choice) => {
              setResolvingConflict(choice === 'reapply' ? conflict.id : null);
              void resolveAndFocus(store, conflict, choice, railRef).finally(() => setResolvingConflict(null));
            }}
            changedCells={store.changedCells}
            charts={chartProps}
            chartBuilder={
              canStructure
                ? {
                    range: chartRange,
                    onRange: setChartRange,
                    title: chartTitle,
                    onTitle: setChartTitle,
                    type: chartType,
                    onType: setChartType,
                    onAdd: addChart,
                    rangeError: chartRangeError,
                    titleError: chartTitleError,
                  }
                : null
            }
            versions={
              canVersions
                ? {
                    list: versions,
                    label: versionLabel,
                    onLabel: setVersionLabel,
                    onSave: () => void saveVersion(),
                    saving: versionSaving,
                    labelError: versionError,
                    onRestore: isManager ? (version) => setRestoreTarget(version) : null,
                  }
                : null
            }
            conflictFocusToken={conflictFocusToken}
            onClose={() => setRailOpen(false)}
          />
        </div>
      </div>

      <p role="status" aria-label="Recalc" className="visually-hidden">
        {store.recalcMessage}
      </p>

      {cutoffDialog ? (
        <CutoffDialog
          mode={cutoffDialog}
          initial={apiStampToLocal(snapshot.closesAt)}
          onClose={() => setCutoffDialog(null)}
          onSave={async (text) => {
            if (cutoffDialog === 'cutoff') {
              const done = await setCutoff(text);
              if (done) setCutoffDialog(null);
              return;
            }
            const trimmed = text.trim();
            if (trimmed !== '' && localStampToApi(trimmed) === null) {
              notify(CUTOFF_FORMAT_ERROR);
              return;
            }
            await seasonAction('reopen', trimmed === '' ? null : localStampToApi(trimmed));
            setCutoffDialog(null);
          }}
        />
      ) : null}

      {sheetDialog ? (
        <SheetNameDialog
          initial={
            sheetDialog.mode === 'rename'
              ? sheets.find((sheet) => sheet.id === sheetDialog.sheetId)?.name ?? ''
              : ''
          }
          onClose={() => setSheetDialog(null)}
          onSave={(name) => {
            if (!store.state) return false;
            const exceptId = sheetDialog.mode === 'rename' ? sheetDialog.sheetId ?? null : null;
            if (!sheetNameIsValid(name, store.state, exceptId)) return false;
            if (sheetDialog.mode === 'add') {
              const newSheetId = newUuid();
              store.commit({ opId: newUuid(), type: 'addSheet', sheetId: newSheetId, name });
              setSheetId(newSheetId);
            } else if (sheetDialog.sheetId) {
              store.commit({ opId: newUuid(), type: 'renameSheet', sheetId: sheetDialog.sheetId, name });
            }
            setSheetDialog(null);
            return true;
          }}
        />
      ) : null}

      {exportDialog ? (
        <ExportDialog
          workbookId={workbookId}
          sheetId={currentSheet.id}
          onClose={() => setExportDialog(false)}
        />
      ) : null}

      {shareDialog ? (
        <ShareDialog workbookId={workbookId} timeZone={store.timeZone} onClose={() => setShareDialog(false)} />
      ) : null}

      {restoreTarget ? (
        <Dialog
          role="alertdialog"
          title={`Restore version ${restoreTarget.number}?`}
          onClose={() => setRestoreTarget(null)}
        >
          <p>Every cell, formula, format and chart goes back to that version.</p>
          <div className="dialog-actions">
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                const target = restoreTarget;
                setRestoreTarget(null);
                void runRestore(target);
              }}
            >
              Restore
            </button>
            <button type="button" className="ghost-button" onClick={() => setRestoreTarget(null)}>
              Cancel
            </button>
          </div>
        </Dialog>
      ) : null}
    </main>
  );
}

async function resolveAndFocus(
  store: WorkbookStore,
  conflict: ConflictDto,
  choice: 'reapply' | 'keep_current',
  railRef: React.RefObject<HTMLDivElement>,
): Promise<void> {
  await store.resolveConflict(conflict, choice);
  window.setTimeout(() => {
    const next = railRef.current?.querySelector<HTMLElement>('.conflict-item .primary-button');
    if (next) next.focus();
    else railRef.current?.querySelector<HTMLElement>('[role="tab"]')?.focus();
  }, 0);
}

function selectionRangeText(selection: GridSelection): string {
  const low = {
    col: Math.min(selection.anchor.col, selection.focus.col),
    row: Math.min(selection.anchor.row, selection.focus.row),
  };
  const high = {
    col: Math.max(selection.anchor.col, selection.focus.col),
    row: Math.max(selection.anchor.row, selection.focus.row),
  };
  return formatRangeRef({ startCol: low.col, startRow: low.row, endCol: high.col, endRow: high.row });
}

function seasonItemEnabled(
  action: SeasonAction | 'cutoff',
  state: string,
  role: 'viewer' | 'technician' | 'lead' | 'data_manager',
): boolean {
  if (action === 'archive') return role === 'data_manager' && state === 'locked';
  if (role !== 'lead' && role !== 'data_manager') return false;
  switch (action) {
    case 'start':
      return state === 'draft';
    case 'close':
      return state === 'in_season';
    case 'reopen':
      return state === 'locked';
    case 'cutoff':
      return state === 'draft' || state === 'in_season';
  }
}

function CutoffDialog({
  mode,
  initial,
  onClose,
  onSave,
}: {
  mode: 'cutoff' | 'reopen';
  initial: string;
  onClose: () => void;
  onSave: (text: string) => Promise<void>;
}): JSX.Element {
  const [text, setText] = useState(mode === 'cutoff' ? initial : '');
  const [pending, setPending] = useState(false);
  return (
    <Dialog title="Season cutoff" onClose={onClose}>
      <label className="field">
        <span>Cutoff (station time)</span>
        <input
          type="text"
          className="numerals"
          placeholder="2026-10-30 17:00"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <div className="dialog-actions">
        <button
          type="button"
          className="primary-button"
          disabled={pending}
          onClick={async () => {
            setPending(true);
            await onSave(text);
            setPending(false);
          }}
        >
          {pending ? 'Saving…' : mode === 'cutoff' ? 'Save cutoff' : 'Reopen'}
        </button>
        <button type="button" className="ghost-button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}

function SheetNameDialog({
  initial,
  onClose,
  onSave,
}: {
  initial: string;
  onClose: () => void;
  onSave: (name: string) => boolean;
}): JSX.Element {
  const [name, setName] = useState(initial);
  const [failure, setFailure] = useState<string | null>(null);
  return (
    <Dialog title="Sheet name" onClose={onClose}>
      <label className="field">
        <span>Sheet name</span>
        <input type="text" value={name} maxLength={31} onChange={(event) => setName(event.target.value)} />
      </label>
      <FieldError text={failure} />
      <div className="dialog-actions">
        <button
          type="button"
          className="primary-button"
          onClick={() => {
            if (!onSave(name.trim())) setFailure(SHEET_NAME_ERROR);
          }}
        >
          Save sheet name
        </button>
        <button type="button" className="ghost-button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}

function ExportDialog({
  workbookId,
  sheetId,
  onClose,
}: {
  workbookId: string;
  sheetId: string;
  onClose: () => void;
}): JSX.Element {
  const [format, setFormat] = useState<'xlsx' | 'csv'>('xlsx');
  const [exports, setExports] = useState<ExportDto[]>([]);
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await api<{ exports: ExportDto[] }>(`/api/workbooks/${workbookId}/exports`);
      setExports(result.exports);
    } catch {
      /* keep the list as it was */
    }
  }, [workbookId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(load, 3000);
    return () => window.clearInterval(timer);
  }, [load]);

  const start = async () => {
    setPending(true);
    try {
      await api(`/api/workbooks/${workbookId}/exports`, {
        method: 'POST',
        body: format === 'csv' ? { format, sheetId } : { format },
      });
      notify("Export queued. We'll email you when it's ready.");
      await load();
    } catch (failure) {
      if (failure instanceof ApiFailure) notify(Object.values(failure.fields)[0] ?? failure.text);
    } finally {
      setPending(false);
    }
  };

  const statusText = (status: ExportDto['status']): string =>
    status === 'ready' ? 'Ready' : status === 'pending' ? 'Pending' : 'Waiting for file storage';

  return (
    <Dialog title="Export workbook" onClose={onClose}>
      <fieldset className="field">
        <legend>Choose a file</legend>
        <label>
          <input type="radio" name="export-format" checked={format === 'xlsx'} onChange={() => setFormat('xlsx')} />
          Excel workbook (.xlsx)
        </label>
        <label>
          <input type="radio" name="export-format" checked={format === 'csv'} onChange={() => setFormat('csv')} />
          CSV of current sheet (.csv)
        </label>
      </fieldset>
      <div className="dialog-actions">
        <button type="button" className="primary-button" disabled={pending} onClick={start}>
          {pending ? 'Starting…' : 'Start export'}
        </button>
        <button type="button" className="ghost-button" onClick={onClose}>
          Close
        </button>
      </div>
      <ul className="export-list" aria-label="Recent exports">
        {exports.map((one) => (
          <li key={one.id}>
            <span className="numerals">{one.fileName}</span>
            <span>{statusText(one.status)}</span>
            {one.status === 'ready' ? (
              <a href={`/api/exports/${one.id}/download`}>Download {one.fileName}</a>
            ) : null}
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

function ShareDialog({
  workbookId,
  timeZone,
  onClose,
}: {
  workbookId: string;
  timeZone: string;
  onClose: () => void;
}): JSX.Element {
  const [seconds, setSeconds] = useState(604800);
  const [links, setLinks] = useState<ShareLinkDto[]>([]);
  const [current, setCurrent] = useState<ShareLinkDto | null>(null);
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await api<{ links: ShareLinkDto[] }>(`/api/workbooks/${workbookId}/share-links`);
      setLinks(result.links);
    } catch {
      /* keep the list as it was */
    }
  }, [workbookId]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    setPending(true);
    try {
      const result = await api<{ link: ShareLinkDto }>(`/api/workbooks/${workbookId}/share-links`, {
        method: 'POST',
        body: { expiresInSeconds: seconds },
      });
      setCurrent(result.link);
      notify(`Link created. It expires ${stamp(result.link.expiresAt, timeZone)}.`);
      await load();
    } catch (failure) {
      if (failure instanceof ApiFailure) notify(Object.values(failure.fields)[0] ?? failure.text);
    } finally {
      setPending(false);
    }
  };

  const fullUrl = current ? `${window.location.origin}${current.url}` : '';

  return (
    <Dialog title="Share read-only link" onClose={onClose}>
      <label className="field">
        <span>Expires in</span>
        <select
          aria-label="Expires in"
          value={seconds}
          onChange={(event) => setSeconds(Number(event.target.value))}
        >
          <option value={86400}>1 day</option>
          <option value={604800}>7 days</option>
          <option value={2592000}>30 days</option>
        </select>
      </label>
      <div className="dialog-actions">
        <button type="button" className="primary-button" disabled={pending} onClick={create}>
          {pending ? 'Saving…' : 'Create link'}
        </button>
      </div>
      <label className="field">
        <span>Share link</span>
        <input type="text" readOnly value={fullUrl} />
      </label>
      <button
        type="button"
        className="ghost-button small"
        onClick={() => {
          void navigator.clipboard?.writeText(fullUrl);
          notify('Link copied.');
        }}
      >
        Copy link
      </button>
      <ul className="share-list" aria-label="Share links">
        {links.map((link) => (
          <li key={link.id}>
            <span className="numerals">
              {link.url} · {link.status} · {stamp(link.expiresAt, timeZone)}
            </span>
            {link.status === 'active' ? (
              <>
                <button
                  type="button"
                  className="ghost-button small"
                  onClick={async () => {
                    await api(`/api/workbooks/${workbookId}/share-links/${link.id}`, { method: 'DELETE' });
                    notify('Link revoked.');
                    setCurrent(null);
                    await load();
                  }}
                >
                  Revoke link
                </button>
                <button
                  type="button"
                  className="ghost-button small"
                  onClick={async () => {
                    const result = await api<{ link: ShareLinkDto }>(
                      `/api/workbooks/${workbookId}/share-links/${link.id}/regenerate`,
                      { method: 'POST' },
                    );
                    setCurrent(result.link);
                    notify('New link created. The old link no longer works.');
                    await load();
                  }}
                >
                  Regenerate link
                </button>
              </>
            ) : null}
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
