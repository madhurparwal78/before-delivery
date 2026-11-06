import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiFailure,
  NoAnswer,
  api,
  type Figure,
  type LedgerEntry,
  type Preview,
  type ProjectDetail,
  type Summary,
  type TimelineDay,
} from '../api';
import { CoverageMap } from '../components/CoverageMap';
import { FigurePanel } from '../components/FigurePanel';
import { SealDialog } from '../components/SealDialog';
import { Timeline, type Brush } from '../components/Timeline';
import { BalanceStrip, FiguresTable, LedgerTable } from '../components/Tables';
import { UnitBreakdownDialog } from '../components/UnitBreakdownDialog';
import { COPY } from '../copy';
import { apiStamp, dateOnly, signedTonnes } from '../format';
import { useLayout, useReducedMotion, useRefresh } from '../hooks';
import { setNotice } from '../notice';
import { navigate } from '../router';
import {
  parseWorkspaceUrl,
  sortSensors,
  workspaceUrl,
  type WorkspaceState,
} from '../workspace-url';

const PREVIEW_THROTTLE_MS = 220;
const SETTLE_MS = 500;

type DialogKind = 'none' | 'breakdown' | 'seal';

export interface WorkspaceProps {
  readonly slug: string;
}

export function Workspace({ slug }: WorkspaceProps): React.ReactElement {
  const layout = useLayout();
  const reducedMotion = useReducedMotion();

  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [state, setState] = useState<WorkspaceState | null>(null);
  const [days, setDays] = useState<TimelineDay[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [figures, setFigures] = useState<Figure[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [ledger, setLedger] = useState<{ entries: LedgerEntry[]; balance: string }>({
    entries: [],
    balance: '0.000',
  });
  const [status, setStatus] = useState('');
  const [windowError, setWindowError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogKind>('none');
  const [sealPending, setSealPending] = useState(false);
  const [sealRefusal, setSealRefusal] = useState<string | null>(null);
  const [sealKey, setSealKey] = useState('');
  const [sealBlockedByRole, setSealBlockedByRole] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [fromInput, setFromInput] = useState('');
  const [toInput, setToInput] = useState('');
  const [focusFigureId, setFocusFigureId] = useState<string | null>(null);

  const previewSeq = useRef(0);
  const lastRequestAt = useRef(0);
  const throttleTimer = useRef<number | null>(null);
  const settleTimer = useRef<number | null>(null);
  const figureLinks = useRef(new Map<string, HTMLAnchorElement>());
  const knownStatuses = useRef(new Map<string, Figure['status']>());

  const role = project?.role ?? 'viewer';

  const lostAccess = useCallback(() => {
    setNotice(COPY.lostAccess);
    navigate('/projects');
  }, []);

  const runPreview = useCallback(
    (brush: Brush, sensors: readonly string[], announce: boolean) => {
      if (project === null || role === 'viewer') return;
      const seq = previewSeq.current + 1;
      previewSeq.current = seq;
      lastRequestAt.current = Date.now();
      void api
        .preview(slug, apiStamp(brush.startMs), apiStamp(brush.endMs), sortSensors(sensors))
        .then((result) => {
          if (seq !== previewSeq.current) return;
          setPreview(result);
          setPreviewFailed(false);
          if (announce) {
            const coverage = result.coverage_pct;
            const net = signedTonnes(result.net_tco2e);
            if (result.sealable) setStatus(COPY.settledSealable(coverage, net));
            else if (result.blocked_reason === 'below_coverage_floor') {
              setStatus(COPY.settledBelowFloor(coverage, net, result.floor_pct));
            } else setStatus(COPY.settledBlocked(coverage, net));
          }
        })
        .catch((error: unknown) => {
          if (seq !== previewSeq.current) return;
          if (error instanceof ApiFailure && error.status === 404) {
            lostAccess();
            return;
          }
          setPreviewFailed(true);
        });
    },
    [project, role, slug, lostAccess],
  );

  const schedulePreview = useCallback(
    (brush: Brush, sensors: readonly string[]) => {
      const since = Date.now() - lastRequestAt.current;
      if (throttleTimer.current !== null) window.clearTimeout(throttleTimer.current);
      if (since >= PREVIEW_THROTTLE_MS) runPreview(brush, sensors, false);
      else {
        throttleTimer.current = window.setTimeout(
          () => runPreview(brush, sensors, false),
          PREVIEW_THROTTLE_MS - since,
        );
      }
      if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
      settleTimer.current = window.setTimeout(
        () => runPreview(brush, sensors, true),
        SETTLE_MS,
      );
    },
    [runPreview],
  );

  const refreshTables = useCallback(async () => {
    try {
      const [figuresResult, ledgerResult] = await Promise.all([
        api.figures(slug),
        api.ledger(slug),
      ]);
      const newlyBroken = figuresResult.figures
        .filter(
          (figure) =>
            figure.status === 'broken' &&
            knownStatuses.current.get(figure.id) !== undefined &&
            knownStatuses.current.get(figure.id) !== 'broken',
        )
        .map((figure) => figure.id)
        .sort();
      knownStatuses.current = new Map(
        figuresResult.figures.map((figure) => [figure.id, figure.status]),
      );
      setFigures(figuresResult.figures);
      setSummary(figuresResult.summary);
      setLedger({ entries: ledgerResult.entries, balance: ledgerResult.balance_tco2e });
      if (newlyBroken.length > 0) {
        setStatus(newlyBroken.map((id) => COPY.sealBroken(id)).join(' '));
      }
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 404) lostAccess();
      else if (error instanceof ApiFailure && error.status === 401) navigate('/signin');
    }
  }, [slug, lostAccess]);

  const loadTimeline = useCallback(
    async (fromDayMs: number, toDayMs: number) => {
      try {
        const result = await api.timeline(slug, dateOnly(fromDayMs), dateOnly(toDayMs));
        setDays(result.days);
      } catch (error) {
        if (error instanceof ApiFailure && error.status === 404) lostAccess();
      }
    },
    [slug, lostAccess],
  );

  useEffect(() => {
    let cancelled = false;
    void api
      .project(slug)
      .then((detail) => {
        if (cancelled) return;
        setProject(detail);
        const parsed = parseWorkspaceUrl(detail, window.location.search);
        setState(parsed);
        if (parsed !== null) {
          setFromInput(dateOnly(parsed.fromDayMs));
          setToInput(dateOnly(parsed.toDayMs));
        }
        window.history.replaceState(null, '', workspaceUrl(slug, parsed));
      })
      .catch((error: unknown) => {
        if (error instanceof ApiFailure && error.status === 404) lostAccess();
        else if (error instanceof ApiFailure && error.status === 401) navigate('/signin');
      });
    return () => {
      cancelled = true;
    };
  }, [slug, lostAccess]);

  useEffect(() => {
    const onPop = (): void => {
      if (project === null) return;
      const parsed = parseWorkspaceUrl(project, window.location.search);
      setState(parsed);
      if (parsed !== null) {
        setFromInput(dateOnly(parsed.fromDayMs));
        setToInput(dateOnly(parsed.toDayMs));
        void loadTimeline(parsed.fromDayMs, parsed.toDayMs);
        runPreview(
          { startMs: parsed.brushStartMs, endMs: parsed.brushEndMs },
          parsed.sensors,
          false,
        );
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [project, loadTimeline, runPreview]);

  const loadedFor = useRef('');
  useEffect(() => {
    if (project === null || state === null) return;
    const signature = `${slug}|${state.fromDayMs}|${state.toDayMs}`;
    if (loadedFor.current === signature) return;
    loadedFor.current = signature;
    void loadTimeline(state.fromDayMs, state.toDayMs);
  }, [project, state, slug, loadTimeline]);

  const firstPreview = useRef(false);
  useEffect(() => {
    if (project === null || state === null || firstPreview.current) return;
    firstPreview.current = true;
    runPreview(
      { startMs: state.brushStartMs, endMs: state.brushEndMs },
      state.sensors,
      false,
    );
  }, [project, state, runPreview]);

  useEffect(() => {
    if (project === null) return;
    void refreshTables();
  }, [project, refreshTables]);

  useRefresh(() => void refreshTables(), sealPending);

  useEffect(() => {
    if (focusFigureId === null) return;
    const element = figureLinks.current.get(focusFigureId);
    if (element !== undefined) {
      element.focus();
      setFocusFigureId(null);
    }
  }, [focusFigureId, figures]);

  const onBrushChange = (brush: Brush): void => {
    if (state === null) return;
    const next = { ...state, brushStartMs: brush.startMs, brushEndMs: brush.endMs };
    setState(next);
    schedulePreview(brush, next.sensors);
    if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      window.history.replaceState(null, '', workspaceUrl(slug, next));
      runPreview(brush, next.sensors, true);
    }, SETTLE_MS);
  };

  const onToggleSensor = (sensorId: string): void => {
    if (state === null) return;
    const selected = state.sensors.includes(sensorId);
    if (selected && state.sensors.length === 1) return;
    const sensors = sortSensors(
      selected
        ? state.sensors.filter((id) => id !== sensorId)
        : [...state.sensors, sensorId],
    );
    const next = { ...state, sensors };
    setState(next);
    window.history.replaceState(null, '', workspaceUrl(slug, next));
    schedulePreview({ startMs: next.brushStartMs, endMs: next.brushEndMs }, sensors);
  };

  const onApplyDates = (): void => {
    if (project === null || state === null) return;
    const fromMs = Date.parse(`${fromInput}T00:00:00Z`);
    const toMs = Date.parse(`${toInput}T00:00:00Z`);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return;
    if (toMs < fromMs) {
      setWindowError(COPY.windowOrder);
      return;
    }
    setWindowError(null);
    const url = `/projects/${slug}?from=${fromInput}&to=${toInput}`;
    const parsed = parseWorkspaceUrl(project, new URL(url, window.location.origin).search);
    if (parsed === null) return;
    setState(parsed);
    navigate(workspaceUrl(slug, parsed));
    void loadTimeline(parsed.fromDayMs, parsed.toDayMs);
    loadedFor.current = `${slug}|${parsed.fromDayMs}|${parsed.toDayMs}`;
    runPreview(
      { startMs: parsed.brushStartMs, endMs: parsed.brushEndMs },
      parsed.sensors,
      false,
    );
  };

  const openSeal = (): void => {
    setSealKey(crypto.randomUUID());
    setSealRefusal(null);
    setSealBlockedByRole(false);
    setDialog('seal');
  };

  const refusalCopyFor = async (error: unknown): Promise<string> => {
    if (error instanceof NoAnswer) return COPY.noAnswer;
    if (!(error instanceof ApiFailure)) return COPY.noAnswer;
    const payload = error.payload;
    switch (error.code) {
      case 'readings_changed':
        return COPY.readingsChanged;
      case 'below_coverage_floor':
        return COPY.belowFloorReason(
          String(payload.coverage_pct ?? ''),
          String(payload.floor_pct ?? ''),
        );
      case 'interval_overlaps_sealed':
        return COPY.overlapsSealed(String(payload.figure_id ?? ''));
      case 'already_sealed':
        return COPY.alreadySealed(String(payload.figure_id ?? ''));
      case 'storage_unavailable':
        return COPY.storageUnavailable;
      case 'mail_unavailable':
        return COPY.mailUnavailable;
      case 'forbidden': {
        const detail = await api.project(slug).catch(() => null);
        if (detail !== null) setProject(detail);
        setSealBlockedByRole(true);
        return detail?.role === 'viewer' ? COPY.viewerRole : COPY.analystRole;
      }
      default:
        if (error.status === 404) {
          lostAccess();
          return COPY.lostAccess;
        }
        return COPY.noAnswer;
    }
  };

  const confirmSeal = async (): Promise<void> => {
    if (preview === null || state === null) return;
    setSealPending(true);
    setSealRefusal(null);
    setStatus(COPY.sealingStatus);
    try {
      const figure = await api.seal(
        slug,
        {
          start: preview.start,
          end: preview.end,
          sensor_ids: preview.sensor_ids,
          preview_fingerprint: preview.fingerprint,
        },
        sealKey,
      );
      setDialog('none');
      setSealPending(false);
      await refreshTables();
      setStatus(
        figure.supersedes === null
          ? COPY.sealed(figure.id, signedTonnes(figure.net_tco2e), figure.coverage_pct)
          : COPY.sealedSupersedes(
              figure.id,
              signedTonnes(figure.net_tco2e),
              figure.coverage_pct,
              figure.supersedes,
            ),
      );
      setFocusFigureId(figure.id);
      runPreview(
        { startMs: state.brushStartMs, endMs: state.brushEndMs },
        state.sensors,
        false,
      );
    } catch (error) {
      const copy = await refusalCopyFor(error);
      setSealPending(false);
      setSealRefusal(copy);
      setStatus(copy);
    }
  };

  if (project === null) {
    return (
      <div className="app-shell">
        <p>Loading project.</p>
      </div>
    );
  }

  const contributing = preview === null ? [] : preview.contributions.map((item) => item.sensor_id);
  const selected = state?.sensors ?? [];
  const lastSelected = selected.length === 1 ? selected[0]! : null;

  const sealReason = ((): string | null => {
    if (role === 'analyst') return COPY.analystRole;
    if (role === 'viewer') return null;
    if (preview === null || preview.sealable) return null;
    switch (preview.blocked_reason) {
      case 'below_coverage_floor':
        return COPY.belowFloorReason(preview.coverage_pct, preview.floor_pct);
      case 'overlaps_sealed':
        return COPY.overlapsSealed(preview.blocking_figure_id ?? '');
      case 'already_sealed':
        return COPY.alreadySealed(preview.blocking_figure_id ?? '');
      case 'role':
        return COPY.analystRole;
      default:
        return null;
    }
  })();

  const timeline =
    state === null ? null : (
      <Timeline
        days={days}
        windowStartMs={state.windowStartMs}
        windowEndMs={state.windowEndMs}
        brush={{ startMs: state.brushStartMs, endMs: state.brushEndMs }}
        hasReadings
        roleCopy={role === 'viewer' ? COPY.viewerRole : null}
        windowError={windowError}
        fromValue={fromInput}
        toValue={toInput}
        onFromChange={setFromInput}
        onToChange={setToInput}
        onApplyDates={onApplyDates}
        onBrushChange={onBrushChange}
      />
    );

  const emptyTimeline = (
    <section className="panel timeline-group" aria-label="Flux timeline" role="group">
      <p>{COPY.noReadings}</p>
    </section>
  );

  const map = (
    <CoverageMap
      boundary={project.boundary}
      sensors={project.sensors}
      selected={selected}
      contributing={contributing}
      onToggle={onToggleSensor}
      lastSelected={lastSelected}
    />
  );

  const sensorList = (
    <section className="panel sensor-list" role="group" aria-label="Sensors">
      {project.sensors.map((sensor) => (
        <label key={sensor.id}>
          <input
            type="checkbox"
            aria-label={sensor.id}
            checked={selected.includes(sensor.id)}
            disabled={lastSelected === sensor.id}
            onChange={() => onToggleSensor(sensor.id)}
          />
          <span className="num">{sensor.id}</span>
          <span>{sensor.kind === 'tower' ? 'Tower' : 'Satellite cell'}</span>
        </label>
      ))}
    </section>
  );

  const figurePanel = (
    <FigurePanel
      preview={preview}
      floorPct={project.floor_pct}
      bufferPct={project.buffer_pct}
      layout={layout}
      reducedMotion={reducedMotion}
      expanded={expanded}
      sealDisabledReason={sealReason}
      canSeal={role === 'sealer' && preview !== null && preview.sealable}
      onOpenBreakdown={() => setDialog('breakdown')}
      onOpenSeal={openSeal}
      onToggleExpanded={() => setExpanded((value) => !value)}
    />
  );

  const tables = (
    <>
      {summary !== null ? <BalanceStrip summary={summary} /> : null}
      <FiguresTable
        figures={figures}
        slug={slug}
        figureLinkRef={(id, element) => {
          if (element === null) figureLinks.current.delete(id);
          else figureLinks.current.set(id, element);
        }}
      />
      <LedgerTable entries={ledger.entries} balance={ledger.balance} />
    </>
  );

  return (
    <div className="app-shell">
      <header className="project-header">
        <h1>{project.name}</h1>
        <div className="meta">
          <span>{project.kind}</span>
          <span className="num">Coverage floor {project.floor_pct}%</span>
          <span className="num">Buffer {project.buffer_pct}%</span>
        </div>
      </header>

      <div role="status" aria-live="polite" aria-label="Workspace status" className="status-line">
        {status}
      </div>
      {previewFailed ? (
        <div role="alert" className="alert">
          {COPY.previewFailed}
        </div>
      ) : null}

      {layout === 'wide' ? (
        <div className="workspace-panes">
          <div className="pane-left">{state === null ? emptyTimeline : timeline}</div>
          <div className="pane-right">
            {map}
            {sensorList}
            {figurePanel}
          </div>
        </div>
      ) : (
        <div className="workspace-panes">
          {map}
          {state === null ? emptyTimeline : timeline}
          {sensorList}
          {layout === 'stacked' ? figurePanel : null}
        </div>
      )}

      {layout === 'sheet' ? (
        <>
          <div className="sheet-spacer" />
          <div className={`sheet ${expanded ? 'expanded' : 'collapsed'}`}>{figurePanel}</div>
        </>
      ) : null}

      {tables}

      {dialog === 'breakdown' && preview !== null ? (
        <UnitBreakdownDialog preview={preview} onClose={() => setDialog('none')} />
      ) : null}
      {dialog === 'seal' && preview !== null ? (
        <SealDialog
          preview={preview}
          pending={sealPending}
          refusal={sealRefusal}
          confirmDisabled={sealBlockedByRole}
          onConfirm={() => void confirmSeal()}
          onCancel={() => {
            if (sealPending) return;
            setDialog('none');
          }}
        />
      ) : null}
    </div>
  );
}
