// The project workspace: timeline, map, sensors and figure panel, the balance strip and the tables.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { request, type ApiResponse } from "../api";
import {
  alreadySealed, belowFloor, brokenOn, COPY, overlaps, sealed as sealedCopy, settledBelowFloor, settledBlocked, settledSealable,
} from "../copy";
import { apiTimestamp } from "../format";
import { useAnnouncer, useMedia, useRefresh } from "../hooks";
import { navigate } from "../router";
import type { Figure, Ledger, Preview, Project, Summary, TimelineDay } from "../types";
import { BalanceStrip, FiguresTable, LedgerTable } from "../ui/tables";
import { CoverageMap } from "./CoverageMap";
import { SealDialog, UnitBreakdownDialog, type SealUi } from "./dialogs";
import { FigurePanel } from "./FigurePanel";
import { sortedIds, canonicalQuery, recordDays, recordOf, stateFromQuery, windowRange, type Range, type WorkspaceState } from "./model";
import { Sensors } from "./Sensors";
import { Timeline } from "./Timeline";

const PREVIEW_GAP_MS = 250;
const SETTLE_MS = 500;
const SEAL_TIMEOUT_MS = 15_000;

const positionKey = (s: WorkspaceState) => `${s.brush.start}|${s.brush.end}|${sortedIds(s.sensors).join(",")}`;

function newIdempotencyKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `seal-${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** The text under Seal figure when the preview cannot be sealed. */
function blockedText(preview: Preview): string | null {
  switch (preview.blocked_reason) {
    case "below_coverage_floor": return belowFloor(preview.coverage_pct, preview.floor_pct);
    case "overlaps_sealed": return overlaps(preview.blocking_figure_id!);
    case "already_sealed": return alreadySealed(preview.blocking_figure_id!);
    case "role": return COPY.roleAnalyst;
    default: return null;
  }
}

function settledText(preview: Preview): string {
  if (preview.sealable) return settledSealable(preview.coverage_pct, preview.net_tco2e);
  if (preview.blocked_reason === "below_coverage_floor") return settledBelowFloor(preview.coverage_pct, preview.net_tco2e, preview.floor_pct);
  return settledBlocked(preview.coverage_pct, preview.net_tco2e);
}

type SealAnswer = Figure & { error?: string; figure_id?: string };

/** The copy for a refused seal; 403s are resolved by the caller from the role the server now reports. */
function refusalText(r: ApiResponse<SealAnswer>): string {
  switch (r.data?.error) {
    case "readings_changed": return COPY.readingsChanged;
    case "below_coverage_floor": return belowFloor(r.data.coverage_pct!, r.data.floor_pct!);
    case "interval_overlaps_sealed": return overlaps(r.data.figure_id!);
    case "already_sealed": return alreadySealed(r.data.figure_id!);
    case "storage_unavailable": return COPY.storageUnreachable;
    case "mail_unavailable": return COPY.mailRefused;
    default: return COPY.noAnswer;
  }
}

export function Workspace({ slug }: { slug: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [state, setState] = useState<WorkspaceState | null>(null);
  const [days, setDays] = useState<TimelineDay[] | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [figures, setFigures] = useState<Figure[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [windowError, setWindowError] = useState(false);
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const [unitOpen, setUnitOpen] = useState(false);
  const [seal, setSeal] = useState<SealUi | null>(null);
  const { region, announce } = useAnnouncer();
  const wide = useMedia("(min-width: 1200px)");

  const stateRef = useRef<WorkspaceState | null>(null);
  const projectRef = useRef<Project | null>(null);
  const previewRef = useRef<{ key: string; data: Preview } | null>(null);
  const latestRequested = useRef<string | null>(null);
  const lastSentAt = useRef(-Infinity);
  const sendTimer = useRef<number | null>(null);
  const settleTimer = useRef<number | null>(null);
  const change = useRef({ seq: 0, settled: true, announced: 0 });
  const statuses = useRef<Map<string, Figure["status"]> | null>(null);
  const sealPending = useRef(false);
  const focusFigure = useRef<string | null>(null);
  const daysWindow = useRef<string | null>(null);

  const sealButton = useRef<HTMLButtonElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const sealReturn = useRef<HTMLElement | null>(null);
  const unitReturn = useRef<HTMLElement | null>(null);
  const tables = useRef<HTMLDivElement>(null);

  const canPreview = (p: Project | null) => p !== null && p.role !== "viewer";
  const loseAccess = useCallback(() => navigate("/projects", { state: { lostAccess: true } }), []);

  // --- Previews: newest position wins; the settled position is announced once ----------------------

  const maybeAnnounce = useCallback(() => {
    const c = change.current;
    const shown = previewRef.current;
    const s = stateRef.current;
    if (!c.settled || c.announced === c.seq || !shown || !s || shown.key !== positionKey(s)) return;
    c.announced = c.seq;
    announce(settledText(shown.data));
  }, [announce]);

  const sendPreview = useCallback(async (s: WorkspaceState) => {
    const key = positionKey(s);
    latestRequested.current = key;
    lastSentAt.current = performance.now();
    const r = await request<Preview>("POST", `/api/projects/${slug}/preview`,
      { start: apiTimestamp(s.brush.start), end: apiTimestamp(s.brush.end), sensor_ids: sortedIds(s.sensors) }).catch(() => null);
    if (latestRequested.current !== key) return;
    if (r?.status === 404) return loseAccess();
    if (r?.status === 403) {
      const fresh = await request<Project>("GET", `/api/projects/${slug}`);
      if (fresh.status === 404) return loseAccess();
      if (fresh.status === 200) {
        projectRef.current = fresh.data;
        setProject(fresh.data);
      }
      previewRef.current = null;
      return setPreview(null);
    }
    if (!r || r.status !== 200) return setPreviewFailed(true);
    setPreviewFailed(false);
    previewRef.current = { key, data: r.data };
    setPreview(r.data);
    maybeAnnounce();
  }, [slug, loseAccess, maybeAnnounce]);

  /** Asks for a preview at most a few times per second; the last position is always sent. */
  const schedulePreview = useCallback(() => {
    if (!canPreview(projectRef.current) || sendTimer.current !== null) return;
    const wait = Math.max(0, lastSentAt.current + PREVIEW_GAP_MS - performance.now());
    const send = () => {
      sendTimer.current = null;
      const s = stateRef.current;
      if (s && positionKey(s) !== latestRequested.current) void sendPreview(s);
    };
    if (wait === 0) send();
    else sendTimer.current = window.setTimeout(send, wait);
  }, [sendPreview]);

  const loadDays = useCallback(async (s: WorkspaceState) => {
    const window = `${s.from}|${s.to}`;
    daysWindow.current = window;
    const r = await request<{ days: TimelineDay[] }>("GET",
      `/api/projects/${slug}/timeline?from=${apiTimestamp(s.from).slice(0, 10)}&to=${apiTimestamp(s.to).slice(0, 10)}`);
    if (r.status === 404) return loseAccess();
    if (r.status === 200 && daysWindow.current === window) setDays(r.data.days);
  }, [slug, loseAccess]);

  const writeAddress = useCallback((s: WorkspaceState, push: boolean) => {
    const url = `/projects/${slug}?${canonicalQuery(s)}`;
    if (location.pathname + location.search === url) return;
    if (push) history.pushState(null, "", url);
    else history.replaceState(null, "", url);
  }, [slug]);

  /** A change made by the person: brush, sensors or dates. Settles 500 ms after the last one. */
  const userChange = useCallback((next: WorkspaceState, { push = false } = {}) => {
    stateRef.current = next;
    setState(next);
    if (push) writeAddress(next, true);
    const c = change.current;
    c.seq += 1;
    c.settled = false;
    if (settleTimer.current !== null) clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      settleTimer.current = null;
      c.settled = true;
      if (stateRef.current) writeAddress(stateRef.current, false);
      maybeAnnounce();
    }, SETTLE_MS);
    schedulePreview();
  }, [schedulePreview, maybeAnnounce, writeAddress]);

  /** Restores the window, brush and sensors from the address (opening it, Back and Forward). */
  const restore = useCallback((p: Project) => {
    const record = recordOf(p);
    if (!record) {
      history.replaceState(history.state, "", `/projects/${slug}`);
      return;
    }
    const s = stateFromQuery(location.search, p, record);
    writeAddress(s, false);
    stateRef.current = s;
    setState(s);
    void loadDays(s);
    if (canPreview(p)) void sendPreview(s);
  }, [slug, loadDays, sendPreview, writeAddress]);

  // --- Project records: summary, figures, ledger -------------------------------------------------

  const loadRecords = useCallback(async () => {
    const [p, f, l] = await Promise.all([
      request<Project>("GET", `/api/projects/${slug}`),
      request<{ figures: Figure[]; summary: Summary }>("GET", `/api/projects/${slug}/figures`),
      request<Ledger>("GET", `/api/projects/${slug}/ledger`),
    ]);
    if ([p, f, l].some((r) => r.status === 404)) return loseAccess();
    if (p.status !== 200 || f.status !== 200 || l.status !== 200) return;
    const before = statuses.current;
    statuses.current = new Map(f.data.figures.map((fig) => [fig.id, fig.status]));
    const newlyBroken = before ? f.data.figures.filter((fig) => fig.status === "broken" && before.get(fig.id) === "sealed").map((fig) => fig.id) : [];
    const roleChanged = projectRef.current !== null && projectRef.current.role !== p.data.role;
    projectRef.current = p.data;
    setProject(p.data);
    setFigures(f.data.figures);
    setSummary(f.data.summary);
    setLedger(l.data);
    if (newlyBroken.length) announce(brokenOn(newlyBroken));
    if (roleChanged && stateRef.current) {
      if (canPreview(p.data)) void sendPreview(stateRef.current);
      else {
        previewRef.current = null;
        setPreview(null);
      }
    }
  }, [slug, loseAccess, announce, sendPreview]);

  useEffect(() => {
    void (async () => {
      const r = await request<Project>("GET", `/api/projects/${slug}`);
      if (r.status === 404) return loseAccess();
      if (r.status !== 200) return;
      projectRef.current = r.data;
      setProject(r.data);
      restore(r.data);
      await loadRecords();
    })();
    const onPop = () => {
      if (location.pathname !== `/projects/${slug}` || !projectRef.current) return;
      if (settleTimer.current !== null) clearTimeout(settleTimer.current);
      change.current = { ...change.current, settled: true, announced: change.current.seq };
      restore(projectRef.current);
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      if (settleTimer.current !== null) clearTimeout(settleTimer.current);
      if (sendTimer.current !== null) clearTimeout(sendTimer.current);
    };
  }, [slug, loseAccess, restore, loadRecords]);

  useRefresh(() => void loadRecords(), () => sealPending.current);

  // Focus the new figure's link once the refetched Figures table shows it.
  useLayoutEffect(() => {
    const id = focusFigure.current;
    if (!id) return;
    const link = tables.current?.querySelector<HTMLElement>(`[data-figure-link="${id}"]`);
    if (link) {
      focusFigure.current = null;
      link.focus();
    }
  }, [figures]);

  // Keyboard focus never lands on a pane hidden under the scrolled records.
  const revealPanes = (event: React.FocusEvent<HTMLDivElement>) => {
    const panes = event.currentTarget.getBoundingClientRect();
    if (wide && window.scrollY > 0 && panes.top <= 0) window.scrollTo({ top: window.scrollY + panes.top, behavior: "instant" });
  };

  // --- Seal ----------------------------------------------------------------------------------

  useLayoutEffect(() => {
    if (seal?.phase !== "answered") return;
    (seal.confirmBlocked ? cancelButton : confirmButton).current?.focus();
  }, [seal]);

  const openSeal = () => {
    if (!preview?.sealable) return;
    sealReturn.current = sealButton.current;
    setSeal({ key: newIdempotencyKey(), preview, phase: "ready", message: null, confirmBlocked: false });
  };

  const cancelSeal = () => {
    const refused = seal?.phase === "answered";
    setSeal(null);
    if (refused && stateRef.current && canPreview(projectRef.current)) void sendPreview(stateRef.current);
  };

  const confirmSeal = async () => {
    if (!seal || sealPending.current) return;
    sealPending.current = true;
    setSeal({ ...seal, phase: "pending", message: null });
    announce(COPY.sealingStatus);
    const p = seal.preview;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), SEAL_TIMEOUT_MS);
    const r = await request<SealAnswer>("POST", `/api/projects/${slug}/figures`,
      { start: p.start, end: p.end, sensor_ids: p.sensor_ids, preview_fingerprint: p.fingerprint },
      { headers: { "Idempotency-Key": seal.key }, signal: controller.signal }).catch(() => null);
    clearTimeout(timer);
    sealPending.current = false;

    if (r?.status === 201) {
      const figure = r.data;
      sealReturn.current = null;
      focusFigure.current = figure.id;
      setSeal(null);
      announce(sealedCopy(figure.id, figure.net_tco2e, figure.coverage_pct, figure.supersedes));
      await loadRecords();
      if (stateRef.current) void sendPreview(stateRef.current);
      return;
    }
    if (r?.status === 404) return loseAccess();
    let message = r ? refusalText(r) : COPY.noAnswer;
    if (r?.status === 403) {
      const fresh = await request<Project>("GET", `/api/projects/${slug}`);
      if (fresh.status === 404) return loseAccess();
      projectRef.current = fresh.data;
      setProject(fresh.data);
      message = fresh.data.role === "viewer" ? COPY.roleViewer : COPY.roleAnalyst;
    }
    const retryable = !r || r.status === 503 || message === COPY.noAnswer;
    setSeal({ ...seal, phase: "answered", message, confirmBlocked: !retryable });
    if (r) announce(message);
  };

  // --- Interaction handlers --------------------------------------------------------------------

  const record = project ? recordOf(project) : null;
  const range: Range | null = state && record ? windowRange(state.from, state.to, record) : null;

  const onBrush = (brush: Range) => state && userChange({ ...state, brush });
  const onToggleSensor = (id: string) => {
    if (!state) return;
    const sensors = state.sensors.includes(id) ? state.sensors.filter((s) => s !== id) : sortedIds([...state.sensors, id]);
    if (sensors.length > 0) userChange({ ...state, sensors });
  };
  const onApply = (from: number, to: number) => {
    if (!state || !record || !project) return false;
    if (to < from) {
      setWindowError(true);
      return false;
    }
    setWindowError(false);
    const next = { ...state, from, to, brush: windowRange(from, to, record) };
    userChange(next, { push: true });
    void loadDays(next);
    return true;
  };
  const openUnit = (event: MouseEvent<HTMLButtonElement>) => {
    unitReturn.current = event.currentTarget;
    setUnitOpen(true);
  };

  if (!project) return <main className="workspace"><p className="loading num page">Loading…</p></main>;

  const viewer = !canPreview(project);
  const shownPreview = viewer ? null : preview;
  const contributing = shownPreview ? shownPreview.contributions.map((c) => c.sensor_id) : null;
  const reason = shownPreview && !shownPreview.sealable ? blockedText(shownPreview) : null;

  const timeline = (
    <Timeline key="timeline" days={days} range={range} brush={state?.brush ?? null} from={state?.from ?? null} to={state?.to ?? null}
      recordDays={record ? recordDays(record) : null} windowError={windowError} viewerNote={viewer} noReadings={!record}
      onBrush={onBrush} onApply={onApply} />
  );
  const map = <CoverageMap key="map" project={project} selected={state?.sensors ?? project.sensors.map((s) => s.id)} contributing={contributing} onToggle={onToggleSensor} />;
  const sensors = <Sensors key="sensors" sensors={project.sensors} selected={state?.sensors ?? project.sensors.map((s) => s.id)} contributing={contributing} onToggle={onToggleSensor} />;
  const panel = (
    <FigurePanel key="panel" preview={shownPreview} floor={project.floor_pct} armed={shownPreview?.sealable ?? false} reason={reason}
      describedBy={viewer ? "viewer-note" : null} failed={!viewer && previewFailed ? COPY.previewFailed : null}
      expanded={sheetExpanded} sealButton={sealButton} onSeal={openSeal} onUnitBreakdown={openUnit}
      onToggleSheet={() => setSheetExpanded((open) => !open)} />
  );

  return (
    <main className="workspace">
      <header className="ws-header">
        <div className="ws-title">
          <h1>{project.name}</h1>
          <p className="ws-meta">
            <span>{project.kind}</span>
            <span>Coverage floor <span className="num">{project.floor_pct}%</span></span>
            <span>Buffer <span className="num">{project.buffer_pct}%</span></span>
          </p>
        </div>
        <div role="status" aria-label="Workspace status" className="status-line num" ref={region} />
      </header>

      <div className={`ws-panes ${wide ? "is-wide" : "is-stacked"}`} onFocus={revealPanes}>
        {wide ? (
          <>
            {timeline}
            <div className="right-pane">{map}{sensors}{panel}</div>
          </>
        ) : (
          <>{map}{timeline}{sensors}{panel}</>
        )}
      </div>

      <div className="ws-records" ref={tables}>
        {summary && <BalanceStrip summary={summary} />}
        <FiguresTable slug={slug} figures={figures} />
        {ledger && <LedgerTable slug={slug} entries={ledger.entries} balance={ledger.balance_tco2e} />}
      </div>

      <UnitBreakdownDialog preview={shownPreview} open={unitOpen} onClose={() => setUnitOpen(false)} returnFocus={unitReturn} />
      <SealDialog seal={seal} onConfirm={() => void confirmSeal()} onCancel={cancelSeal}
        confirmButton={confirmButton} cancelButton={cancelButton} returnFocus={sealReturn} />
    </main>
  );
}
