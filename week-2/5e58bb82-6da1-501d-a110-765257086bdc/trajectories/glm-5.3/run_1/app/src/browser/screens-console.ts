/* Mission console: header counters, chart with lens, lines table, holidays, infill queues. */
import { Mission, Line, Holiday, Vessel, Alert, Units, Position } from './app.js';
import { apiFetch, ApiError } from './api.js';
import { h, clear, focusSafe, openModal, prefersReducedMotion } from './dom.js';
import { store, announce } from './state.js';
import { fmtPct, fmtArea, fmtLength, fmtPos } from './app.js';
import { Chart, ChartData } from './chart.js';
import { alertsRegion, vesselCard } from './screens-core.js';

export interface ConsoleData {
  mission: Mission;
  lines: Line[];
  holidays: Holiday[];
  coverage: { origin: { easting: number; northing: number }; cols: number; rows: number; overlap: number[][] } | null;
  tracks: Record<string, { t: string; easting: number; northing: number; depth_m: number; swath_m: number }[]>;
}

export async function loadConsoleData(missionId: string): Promise<ConsoleData | null> {
  try {
    const [mission, lines, holidays, coverage, tracks] = await Promise.all([
      apiFetch<Mission>('GET', `/api/missions/${missionId}`),
      apiFetch<Line[]>('GET', `/api/missions/${missionId}/lines`),
      apiFetch<Holiday[]>('GET', `/api/missions/${missionId}/holidays`),
      apiFetch<{ origin: { easting: number; northing: number }; cols: number; rows: number; overlap: number[][] }>('GET', `/api/missions/${missionId}/coverage`),
      apiFetch<{ tracks: { line_id: string; points: { t: string; easting: number; northing: number; depth_m: number; swath_m: number }[] }[] }>('GET', `/api/missions/${missionId}/tracks`),
    ]);
    const byId = new Map(lines.map(l => [l.id, l]));
    const tracksMap: ConsoleData['tracks'] = {};
    for (const t of tracks.tracks) {
      if (byId.has(t.line_id)) tracksMap[t.line_id] = t.points;
    }
    return { mission, lines, holidays, coverage, tracks: tracksMap };
  } catch (e) {
    const e2 = e as ApiError;
    if (e2.status === 404) return null;
    return null;
  }
}

export class ConsoleScreen {
  private chart: Chart | null = null;
  private data: ConsoleData | null = null;
  private gridMode = false;
  private focusedCell: { r: number; c: number } | null = null;
  private missionId: string;
  private root: HTMLElement;
  private readoutEl: HTMLElement | null = null;
  // chart state preserved across refreshes
  private savedView: { cx: number; cy: number; scale: number } | null = null;
  private savedLens: Position | null = null;
  private savedLensOpen = false;
  private hadChartFocus = false;

  constructor(root: HTMLElement, missionId: string) {
    this.root = root;
    this.missionId = missionId;
  }

  setView(view: string | null): void {
    this.gridMode = view === 'table';
  }

  async render(): Promise<boolean> {
    // capture the previous chart's state before re-rendering
    if (this.chart) {
      this.savedView = { ...this.chart.view };
      this.savedLens = this.chart.lensPos ? { ...this.chart.lensPos } : null;
      this.savedLensOpen = this.chart.lensOpen;
      this.hadChartFocus = document.activeElement === this.chart.canvas;
    }
    const data = await loadConsoleData(this.missionId);
    if (!data) return false;
    const first = this.data === null;
    const missionChanged = !this.data || this.data.mission.version !== data.mission.version;
    this.data = data;
    clear(this.root);
    const user = store.user!;
    const m = data.mission;
    const clientMode = user.role === 'client_reviewer';

    const statusWord = m.status + (m.hold ? ` (on hold)` : '');
    const agreement = m.crossline_agreement;
    const agreementText = agreement.compared === 0 ? '—' : `${agreement.pct}% of ${agreement.compared}`;

    const header = h('section', { class: 'mission-header', 'aria-label': 'Mission header' },
      h('div', { class: 'mh-top' },
        h('h1', {}, m.name),
        h('span', { class: 'status-word mono' }, statusWord),
        m.hold ? h('p', { class: 'hold-note' }, `On hold: ${m.hold.reason}`) : null,
      ),
      h('div', { class: 'mh-groups' },
        h('div', { role: 'group', 'aria-label': 'Coverage', class: 'counter' },
          h('span', { class: 'counter-label' }, 'Coverage'),
          h('span', { class: 'counter-value mono' }, fmtPct(m.counters.coverage_pct))),
        h('div', { role: 'group', 'aria-label': 'Open holidays', class: 'counter' },
          h('span', { class: 'counter-label' }, 'Open holidays'),
          h('span', { class: 'counter-value mono' }, String(m.counters.open_holidays))),
        h('div', { role: 'group', 'aria-label': 'Lines remaining', class: 'counter' },
          h('span', { class: 'counter-label' }, 'Lines remaining'),
          h('span', { class: 'counter-value mono' }, String(m.counters.lines_remaining))),
        h('div', { role: 'group', 'aria-label': 'Crossline agreement', class: 'counter' },
          h('span', { class: 'counter-label' }, 'Crossline agreement'),
          h('span', { class: 'counter-value mono' }, agreementText)),
      ),
      h('div', { class: 'mh-actions' },
        h('a', { class: 'btn subtle', href: `/api/missions/${m.id}/coverage.csv` }, 'Download coverage CSV'),
        !clientMode && m.report.state === 'Ready' ? h('a', { class: 'btn subtle', href: `/api/missions/${m.id}/report` }, 'Download coverage report') : null,
        m.report.state === 'Pending' ? h('span', { class: 'mono' }, 'Coverage report is being prepared') : null,
        !clientMode && m.report.state === 'Ready' && user.role === 'client_reviewer' ? h('a', { class: 'btn subtle', href: `/api/missions/${m.id}/report` }, 'Download coverage report') : null,
        this.consoleActions(m, user),
      ),
    );
    void missionChanged;

    // chart + lens readout
    const canvasHolder = h('div', { class: 'chart-holder', 'aria-label': 'Survey chart region' });
    const canvas = h('canvas', { class: 'chart-canvas' }) as HTMLCanvasElement;
    canvasHolder.append(canvas);
    const zoomIn = h('button', { class: 'btn subtle', 'aria-label': 'Zoom in' }, 'Zoom in');
    const zoomOut = h('button', { class: 'btn subtle', 'aria-label': 'Zoom out' }, 'Zoom out');
    const fit = h('button', { class: 'btn subtle', 'aria-label': 'Fit survey area' }, 'Fit survey area');
    const viewToggle = h('button', {
      class: 'btn subtle', 'aria-pressed': String(this.gridMode),
      onclick: () => {
        this.gridMode = !this.gridMode;
        const p = new URLSearchParams(location.search);
        if (this.gridMode) p.set('view', 'table'); else p.delete('view');
        window.history.replaceState({}, '', location.pathname + (p.toString() ? `?${p}` : ''));
        void this.render();
      },
    }, 'View as table');
    canvasHolder.append(h('div', { class: 'chart-tools' }, zoomIn, zoomOut, fit, viewToggle));

    const chartData: ChartData = {
      mission: m,
      lines: data.lines,
      holidays: data.holidays,
      coverage: data.coverage,
      tracks: data.tracks,
      vessels: store.vessels.filter(v => m.vessels.some(mv => mv.id === v.id)),
      clientMode,
    };

    if (!this.gridMode) {
      const chart = new Chart(canvas);
      if (this.savedView) chart.view = { ...this.savedView };
      if (this.savedLens) {
        chart.lensPos = { ...this.savedLens };
        chart.lensTarget = { ...this.savedLens };
        chart.lensOpen = this.savedLensOpen;
      }
      chart.setData(chartData);
      this.chart = chart;
      zoomIn.addEventListener('click', () => chart.zoom(1.25));
      zoomOut.addEventListener('click', () => chart.zoom(0.8));
      fit.addEventListener('click', () => chart.fit(m.survey_area));
      chart.onLensChange = () => this.updateReadout();
      chart.onQueueInfill = (holidayId) => void this.queueInfill(holidayId);
      chart.bindTouch(canvasHolder);
      canvasHolder.addEventListener('pointermove', (e: PointerEvent) => {
        if (e.pointerType === 'mouse') {
          const rect = canvas.getBoundingClientRect();
          chart.openLens(chart.toGround(e.clientX - rect.left, e.clientY - rect.top));
          chart.setLensTarget(chart.toGround(e.clientX - rect.left, e.clientY - rect.top), true);
        }
      });
      canvasHolder.addEventListener('pointerleave', () => { if (!chart.keyboardMode) chart.closeLens(); });
      canvasHolder.addEventListener('click', (e: MouseEvent) => {
        if (e.target === canvas) {
          const rect = canvas.getBoundingClientRect();
          const p = chart.toGround(e.clientX - rect.left, e.clientY - rect.top);
          const h2 = chart.holidayAt(p);
          if (h2) void this.queueInfill(h2.id);
        }
      });
      canvas.addEventListener('focus', () => {
        chart.keyboardMode = true;
        chart.openLens(chart.lensPos ?? { easting: chart.view.cx, northing: chart.view.cy });
        this.updateReadout();
      });
      canvas.addEventListener('blur', () => {
        chart.keyboardMode = false;
        chart.closeLens();
      });
      canvas.addEventListener('keydown', (e: KeyboardEvent) => {
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
          e.preventDefault();
          const step = e.shiftKey ? 50 : 10;
          const d = { ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.key] as [number, number];
          chart.moveLensBy(step, d[0], d[1]);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          const p = chart.lensPos;
          if (!p) { announce('No holiday under the lens'); return; }
          const h2 = chart.holidayAt(p) ?? this.bestHolidayInLens();
          if (h2) void this.queueInfill(h2.id);
          else announce('No holiday under the lens');
        }
      });
      this.readoutEl = h('div', { class: 'lens-readout', role: 'group', 'aria-label': 'Lens readout' });
      canvasHolder.append(this.readoutEl);
    } else {
      this.chart = null;
      this.readoutEl = null;
      canvasHolder.append(this.buildGrid(data));
    }

    // rail: alerts + vessels on mission
    const ack = async (a: Alert): Promise<void> => {
      try {
        await apiFetch('POST', `/api/alerts/${a.id}/ack`, {});
        announce('Alert acknowledged');
      } catch { /* keep */ }
    };
    const rail = h('aside', { class: 'fleet-rail' },
      alertsRegion(store.alerts.filter(a => a.mission_id === m.id), (a) => void ack(a)),
      h('section', { 'aria-label': 'Fleet', class: 'fleet-region' },
        h('ul', { 'aria-label': 'Vessels', class: 'vessel-list' },
          ...store.vessels.filter(v => m.vessels.some(mv => mv.id === v.id)).map(v =>
            vesselCard(v, {
              coverage: m.counters.coverage_pct,
              onSelect: () => { window.location.href = `/fleet/${v.id}`; },
            })))));

    // holidays list
    const holidaysList = this.buildHolidaysList(data);

    // detail pane: lines table + plan summary + infill queues
    const detail = h('section', { class: 'detail-pane', 'aria-label': 'Mission detail' });
    detail.append(this.buildLinesTable(data));
    detail.append(this.buildInfillQueues(data));
    detail.append(this.buildPlanSummary(m));

    this.root.append(
      header,
      h('div', { class: `console-grid console ${this.gridMode ? 'grid-mode' : ''}` },
        rail,
        h('main', { class: 'chart-pane' }, canvasHolder, holidaysList),
        h('section', { class: 'detail-col' }, detail),
      ),
    );
    if (first) {
      const firstCell = this.root.querySelector('.mh-top h1') as HTMLElement;
      void firstCell;
    }
    if (!this.gridMode && this.chart) {
      this.chart.draw();
      this.updateReadout();
      if (this.hadChartFocus) this.chart.canvas.focus();
    }
    return true;
  }

  private bestHolidayInLens(): Holiday | null {
    const list = this.chart?.lensHolidays() ?? [];
    return list.length ? list.reduce((best, h) => h.cell_count > best.cell_count ? h : best, list[0]!) : null;
  }

  private updateReadout(): void {
    if (!this.readoutEl || !this.chart || !this.data) return;
    const p = this.chart.lensPos;
    const lines: string[] = [];
    if (p) lines.push(fmtPos(p, store.units));
    const inLens = this.chart.lensHolidays();
    if (inLens.length === 0) lines.push('No holidays — coverage is continuous');
    for (const h of inLens) lines.push(`${h.label} · ${fmtArea(h.area_m2, store.units)}`);
    const text = lines.join('\n');
    if (this.readoutEl.textContent !== text) this.readoutEl.textContent = text;
  }

  private buildHolidaysList(data: ConsoleData): HTMLElement {
    const list = h('ul', { class: 'holidays-list', 'aria-label': 'Holidays' });
    const openOnQueued = data.holidays.filter(h2 => h2.status === 'Open' || h2.status === 'Queued');
    if (openOnQueued.length === 0) {
      list.append(h('li', { class: 'mono' }, 'No holidays — coverage is continuous'));
    }
    for (const h2 of openOnQueued) {
      const queuedTo = h2.status === 'Queued' && h2.infill_line_id
        ? `Queued to ${data.lines.find(l => l.id === h2.infill_line_id)?.vessel_name ?? ''}` : '';
      const btn = h('button', { class: 'btn subtle holiday-queue-btn', 'aria-label': `Queue infill ${h2.label}` }, 'Queue infill') as HTMLButtonElement;
      btn.addEventListener('click', () => void this.queueInfill(h2.id, btn));
      list.append(h('li', { class: 'holiday-item', tabindex: '-1', 'data-holiday-id': h2.id },
        h('span', { class: 'mono' }, `${h2.label} · ${fmtArea(h2.area_m2, store.units)} · ${h2.nearest_vessel ? `nearest ${h2.nearest_vessel.name}` : 'no eligible vessel'}`),
        queuedTo ? h('span', { class: 'mono queued-to' }, queuedTo) : null,
        btn,
      ));
    }
    return h('section', { class: 'holidays-region', 'aria-label': 'Holidays region' },
      h('h2', { class: 'region-heading' }, 'Holidays'),
      list);
  }

  private async queueInfill(holidayId: string, btnEl?: HTMLButtonElement): Promise<void> {
    const h2 = this.data?.holidays.find(x => x.id === holidayId);
    if (!h2) return;
    const btn = btnEl ?? (document.querySelector(`[data-holiday-id="${holidayId}"] .holiday-queue-btn`) as HTMLButtonElement | null);
    if (btn) { btn.disabled = true; btn.textContent = 'Queueing…'; }
    announce(`Queueing infill for ${h2.label}`);
    try {
      const resp = await apiFetch<{ line: Line; holiday: Holiday; counters: Mission['counters'] }>('POST', `/api/missions/${this.missionId}/holidays/${holidayId}/infill`, {});
      announce(`Infill ${resp.line.label} queued to ${resp.line.vessel_name}`);
    } catch (err) {
      const e2 = err as ApiError;
      announce(e2.body?.message ?? `Could not reach Swathdeck — ${h2.label} is not queued yet`);
      if (btn) { btn.disabled = false; btn.textContent = 'Queue infill'; }
    }
  }

  private buildLinesTable(data: ConsoleData): HTMLElement {
    const rows: HTMLElement[] = [];
    for (const l of data.lines) {
      const rerunnable = (l.status === 'Surveyed' || l.status === 'Delivered') && l.kind !== 'infill';
      const fileCell = l.file ? (l.file.state === 'Stored' ? 'Stored' : 'Awaiting upload') : '';
      const rerunBtn = rerunnable && store.user?.role === 'principal_surveyor'
        ? h('button', { class: 'btn subtle rerun-btn', 'aria-label': `Re-run ${l.label}` }, `Re-run ${l.label}`) : null;
      if (rerunBtn) {
        rerunBtn.addEventListener('click', () => {
          openModal({ label: 'Re-run line' }, (root2, close) => {
            const reason = h('textarea', { 'aria-label': 'Reason', rows: '3' }) as HTMLTextAreaElement;
            const go = h('button', { class: 'btn primary' }, 'Create re-run');
            go.addEventListener('click', async () => {
              try {
                const r = await apiFetch<{ line: Line }>('POST', `/api/missions/${this.missionId}/lines/${l.id}/rerun`, { reason: reason.value });
                announce(`${r.line.label} added — assign a vessel to run it`);
                close();
                await this.render();
                const row = this.root.querySelector(`[data-line-row="${r.line.id}"]`) as HTMLElement;
                if (row) { focusSafe(row); }
              } catch (err) {
                const e2 = err as ApiError;
                const errEl = root2.querySelector('.dialog-error') as HTMLElement;
                if (errEl) errEl.textContent = e2.body?.errors?.reason ?? e2.body?.message ?? 'Could not re-run';
              }
            });
            root2.append(
              h('h2', {}, 'Re-run line'),
              h('p', {}, `${l.label} will run again as a new line.`),
              h('label', {}, 'Reason'), reason,
              h('p', { class: 'dialog-error field-error' }),
              h('div', { class: 'dialog-actions' }, go, h('button', { class: 'btn subtle', onclick: close }, 'Cancel')),
            );
            reason.focus();
          });
        });
      }
      rows.push(h('tr', { tabindex: '-1', 'data-line-row': l.id },
        h('td', { class: 'mono' }, l.label),
        h('td', {}, l.kind === 'planned' ? 'Planned' : l.kind === 'crossline' ? 'Crossline' : 'Infill'),
        h('td', {}, l.vessel_name ?? ''),
        h('td', {}, l.status),
        h('td', { class: 'mono' }, fileCell),
        h('td', {}, rerunBtn),
      ));
    }
    return h('section', { class: 'lines-section' },
      h('h2', { class: 'region-heading' }, 'Lines'),
      h('table', { class: 'table lines-table', 'aria-label': 'Lines' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Line'), h('th', {}, 'Kind'), h('th', {}, 'Vessel'), h('th', {}, 'Status'), h('th', {}, 'File'))),
        h('tbody', {}, ...rows)));
  }

  private buildInfillQueues(data: ConsoleData): HTMLElement {
    const wrap = h('div', { class: 'infill-queues' });
    const queues = new Map<string, Line[]>();
    for (const l of data.lines) {
      if (l.kind === 'infill' && l.status === 'Assigned' && l.vessel_id) {
        const arr = queues.get(l.vessel_id) ?? [];
        arr.push(l);
        queues.set(l.vessel_id, arr);
      }
    }
    for (const [vesselId, lines] of queues) {
      const items = h('ul', { class: 'infill-queue', 'aria-label': `Infill queue for ${lines[0]?.vessel_name ?? vesselId}` });
      const ordered = [...lines];
      ordered.forEach((l, i) => {
        const li = h('li', { class: 'mono queue-item', tabindex: '-1', 'data-line-id': l.id },
          `${i + 1}. ${l.label} · ${data.holidays.find(hh => hh.id === l.holiday_id)?.label ?? ''}`);
        li.addEventListener('keydown', (e: KeyboardEvent) => {
          if (!e.altKey || !['ArrowUp', 'ArrowDown'].includes(e.key)) return;
          e.preventDefault();
          const dir = e.key === 'ArrowUp' ? -1 : 1;
          const idx = ordered.indexOf(l);
          const target = idx + dir;
          if (target < 0 || target >= ordered.length) return;
          const moved = [...ordered];
          moved.splice(target, 0, moved.splice(idx, 1)[0]!);
          const ids = moved.map(x => x.id);
          void apiFetch<{ line_ids: string[] }>('PUT', `/api/missions/${this.missionId}/vessels/${vesselId}/infill-order`, { line_ids: ids })
            .then(() => {
              ordered.length = 0;
              ordered.push(...moved);
              announce(`${l.label} moved to position ${target + 1} of ${ordered.length}`);
              const list = li.parentElement;
              if (list) {
                clear(list);
                ordered.forEach((l2, i2) => {
                  const clone = h('li', { class: 'mono queue-item', tabindex: '-1' }, `${i2 + 1}. ${l2.label} · ${data.holidays.find(hh => hh.id === l2.holiday_id)?.label ?? ''}`);
                  list.append(clone);
                });
                const targetLi = list.children[target] as HTMLElement;
                focusSafe(targetLi);
              }
            })
            .catch((err) => {
              const e2 = err as ApiError;
              announce(e2.body?.error === 'stale_order'
                ? 'The infill queue for this vessel has changed — showing the latest order'
                : 'Could not reach Swathdeck — the infill order is unchanged');
            });
        });
        items.append(li);
      });
      wrap.append(h('section', { class: 'infill-queue-section' },
        h('h3', { class: 'region-heading' }, `Infill queue for ${lines[0]?.vessel_name ?? vesselId}`),
        items));
    }
    return wrap;
  }

  private buildPlanSummary(m: Mission): HTMLElement {
    return h('section', { class: 'plan-summary', 'aria-label': 'Plan summary' },
      h('h2', { class: 'region-heading' }, 'Plan summary'),
      h('dl', { class: 'summary-facts mono' },
        h('div', {}, h('dt', {}, 'Survey order'), h('dd', {}, m.survey_order === 'special' ? 'Special Order' : 'Order 1a')),
        h('div', {}, h('dt', {}, 'Lines'), h('dd', {}, String(m.line_count))),
        h('div', {}, h('dt', {}, 'Crosslines'), h('dd', {}, String(m.crossline_count))),
        h('div', {}, h('dt', {}, 'Estimated duration'), h('dd', {}, `${Math.round(m.estimated_duration_s / 60)} min`)),
        h('div', {}, h('dt', {}, 'Swath width'), h('dd', {}, fmtLength(m.swath_width_m, store.units))),
        h('div', {}, h('dt', {}, 'Line spacing'), h('dd', {}, fmtLength(m.line_spacing_m, store.units)))));
  }

  // ARIA grid view of coverage
  private buildGrid(data: ConsoleData): HTMLElement {
    const cov = data.coverage;
    if (!cov) return h('p', {}, 'Coverage is not available yet');
    const holidaysByCell = new Map<string, Holiday>();
    for (const hd of data.holidays) {
      if (hd.status === 'Closed') continue;
      for (const [c, r] of hd.cells) holidaysByCell.set(`${c},${r}`, hd);
    }
    const table = h('div', {
      role: 'grid', 'aria-label': 'Coverage table',
      class: 'coverage-grid',
      'aria-rowcount': String(cov.rows),
      'aria-colcount': String(cov.cols),
      tabindex: '0',
    });
    const focusCell = this.focusedCell ?? { r: Math.floor(cov.rows / 2), c: Math.floor(cov.cols / 2) };
    this.focusedCell = focusCell;
    const renderRows = (from: number, to: number): void => {
      clear(table);
      for (let rr = from; rr <= to; rr++) {
        const row = h('div', { role: 'row', class: 'grid-row', 'aria-rowindex': String(rr + 1) });
        for (let cc = 0; cc < cov.cols; cc++) {
          const v = cov.overlap[rr]?.[cc] ?? -1;
          const hd = holidaysByCell.get(`${cc},${rr}`);
          const text = v < 0 ? 'outside' : hd ? `${hd.label} ${v}` : String(v > 2 ? '3+' : v);
          const cell = h('div', {
            role: 'gridcell', class: `grid-cell cov-${v < 0 ? 'out' : v === 0 ? 'zero' : v}`,
            'aria-colindex': String(cc + 1),
            'aria-rowindex': String(rr + 1),
            tabindex: rr === focusCell.r && cc === focusCell.c ? '0' : '-1',
            text,
          });
          row.append(cell);
        }
        table.append(row);
      }
    };
    const rowWindow = 20;
    const half = Math.floor(rowWindow / 2);
    renderRows(Math.max(0, focusCell.r - half), Math.min(cov.rows - 1, focusCell.r + half));
    table.addEventListener('keydown', (e: KeyboardEvent) => {
      if (!this.focusedCell || !cov) return;
      const { r, c } = this.focusedCell;
      let nr = r, nc = c;
      switch (e.key) {
        case 'ArrowUp': nr = Math.max(0, r - 1); break;
        case 'ArrowDown': nr = Math.min(cov.rows - 1, r + 1); break;
        case 'ArrowLeft': nc = Math.max(0, c - 1); break;
        case 'ArrowRight': nc = Math.min(cov.cols - 1, c + 1); break;
        case 'Home': nc = 0; break;
        case 'End': nc = cov.cols - 1; break;
        case 'PageUp': nr = Math.max(0, r - 10); break;
        case 'PageDown': nr = Math.min(cov.rows - 1, r + 10); break;
        default: return;
      }
      e.preventDefault();
      this.focusedCell = { r: nr, c: nc };
      const from = Math.max(0, nr - half);
      const to = Math.min(cov.rows - 1, nr + half);
      renderRows(from, to);
      const cell = table.querySelector(`[aria-rowindex="${nr + 1}"][aria-colindex="${nc + 1}"]`) as HTMLElement | null;
      if (cell) cell.focus();
      this.updateReadoutFromCell(nr, nc);
    });
    table.addEventListener('click', (e: MouseEvent) => {
      const cell = (e.target as HTMLElement).closest('[role="gridcell"]') as HTMLElement | null;
      if (!cell || !cov) return;
      const r = Number(cell.getAttribute('aria-rowindex')) - 1;
      const c = Number(cell.getAttribute('aria-colindex')) - 1;
      this.focusedCell = { r, c };
      this.updateReadoutFromCell(r, c);
    });
    table.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && this.focusedCell) {
        e.preventDefault();
        const { r, c } = this.focusedCell;
        const hd = holidaysByCell.get(`${c},${r}`);
        if (hd) void this.queueInfill(hd.id);
        else announce('No holiday under the lens');
      }
    });
    const halfRow = Math.floor(cov.rows / 2);
    void halfRow;
    setTimeout(() => {
      const cell = table.querySelector('[tabindex="0"]') as HTMLElement | null;
      if (cell) cell.focus();
    }, 0);
    return table;
  }

  private updateReadoutFromCell(r: number, c: number): void {
    if (!this.data?.coverage) return;
    const { origin } = this.data.coverage;
    const centre = { easting: origin.easting + c * 5 + 2.5, northing: origin.northing + r * 5 + 2.5 };
    const hd = this.data.holidays.find(h2 => h2.status !== 'Closed' && h2.cells.some(([cc, rr]) => cc === c && rr === r));
    const lines = [fmtPos(centre, store.units)];
    if (hd) lines.push(`${hd.label} · ${fmtArea(hd.area_m2, store.units)}`);
    if (this.readoutEl) {
      this.readoutEl.textContent = lines.join('\n');
    } else {
      const ro = this.root.querySelector('.lens-readout') as HTMLElement | null;
      if (ro) ro.textContent = lines.join('\n');
      else {
        const ro2 = h('div', { class: 'lens-readout', role: 'group', 'aria-label': 'Lens readout' }, lines.join('\n'));
        this.root.querySelector('.chart-holder')?.append(ro2);
      }
    }
  }

  private consoleActions(m: Mission, user: { role: string; id: string }): HTMLElement {
    const wrap = h('div', { class: 'console-actions' });
    if (user.role === 'principal_surveyor') {
      const isOwner = m.owner_id === user.id;
      const note = h('span', { class: 'owner-note mono' }, isOwner ? '' : `Owned by ${m.owner_name}`);
      if (m.status === 'Planned') {
        const launch = h('button', { class: 'btn primary', disabled: !isOwner }, 'Launch mission');
        if (isOwner) {
          launch.addEventListener('click', async () => {
            announce('Launching mission');
            try {
              await apiFetch('POST', `/api/missions/${m.id}/transitions`, { to: 'Launched' });
              announce('Mission launched');
              await this.render();
            } catch (err) {
              const e2 = err as ApiError;
              announce(e2.body?.message ?? 'Launching failed');
            }
          });
        }
        wrap.append(launch);
      }
      if (['Launched', 'Surveying', 'Recovering'].includes(m.status)) {
        const abort = h('button', { class: 'btn subtle', disabled: !isOwner }, 'Abort mission');
        if (isOwner) {
          abort.addEventListener('click', () => {
            openModal({ label: 'Abort mission' }, (root2, close) => {
              const confirm = h('button', { class: 'btn primary' }, 'Abort mission');
              confirm.addEventListener('click', async () => {
                close();
                announce('Aborting mission');
                try {
                  await apiFetch('POST', `/api/missions/${m.id}/transitions`, { to: 'Aborted' });
                  announce('Mission aborted');
                  await this.render();
                } catch (err) {
                  const e2 = err as ApiError;
                  announce(e2.body?.message ?? 'Aborting failed');
                }
              });
              root2.append(
                h('h2', {}, 'Abort mission'),
                h('p', {}, `Abort ${m.name}? Lines already surveyed keep their files.`),
                h('div', { class: 'dialog-actions' }, confirm, h('button', { class: 'btn subtle', onclick: close }, 'Keep surveying')),
              );
              confirm.focus();
            });
          });
        }
        wrap.append(abort);
      }
      if (m.status === 'Surveying') {
        const hold = h('button', { class: 'btn subtle', disabled: !isOwner }, 'Hold for weather');
        if (isOwner) {
          hold.addEventListener('click', () => {
            openModal({ label: 'Hold for weather' }, (root2, close) => {
              const reason = h('textarea', { 'aria-label': 'Reason', rows: '2' }) as HTMLTextAreaElement;
              const go = h('button', { class: 'btn primary' }, 'Hold survey');
              go.addEventListener('click', async () => {
                try {
                  await apiFetch('POST', `/api/missions/${m.id}/hold`, { reason: reason.value });
                  close();
                  announce('Survey held');
                  await this.render();
                } catch (err) {
                  const e2 = err as ApiError;
                  const er = root2.querySelector('.dialog-error') as HTMLElement;
                  if (er) er.textContent = e2.body?.errors?.reason ?? e2.body?.message ?? 'Could not hold';
                }
              });
              root2.append(h('h2', {}, 'Hold for weather'),
                h('label', {}, 'Reason'), reason,
                h('p', { class: 'dialog-error field-error' }),
                h('div', { class: 'dialog-actions' }, go, h('button', { class: 'btn subtle', onclick: close }, 'Cancel')));
              reason.focus();
            });
          });
        }
        wrap.append(hold);
        if (m.hold) {
          const resume = h('button', { class: 'btn primary', disabled: !isOwner }, 'Resume survey');
          if (isOwner) {
            resume.addEventListener('click', async () => {
              try {
                await apiFetch('POST', `/api/missions/${m.id}/resume`, {});
                announce('Survey resumed');
                await this.render();
              } catch { /* keep */ }
            });
          }
          wrap.append(resume);
        }
      }
      // hand over
      const handover = h('button', { class: 'btn subtle', disabled: !isOwner }, 'Hand over');
      if (isOwner) {
        handover.addEventListener('click', () => {
          openModal({ label: 'Hand over mission' }, (root2, close) => {
            const combo = h('select', { 'aria-label': 'Surveyor', class: 'mono' }) as HTMLSelectElement;
            // The seed's two principal surveyors; the current owner is excluded.
            const peers: { id: string; name: string }[] = [
              { id: 'u-ira', name: 'Ira Penhallow' },
              { id: 'u-wren', name: 'Wren Calloway' },
            ].filter(u => u.id !== m.owner_id);
            for (const p of peers) {
              combo.append(h('option', { value: p.id }, p.name));
            }
            const go = h('button', { class: 'btn primary' }, 'Hand over');
            go.addEventListener('click', async () => {
              try {
                const resp = await apiFetch<Mission>('POST', `/api/missions/${m.id}/handover`, { to_user_id: combo.value, version: m.version });
                close();
                announce(`Handed ${m.name} to ${resp.owner_name}`);
                await this.render();
              } catch (err) {
                const e2 = err as ApiError;
                const er = root2.querySelector('.dialog-error') as HTMLElement;
                if (er) er.textContent = e2.body?.message ?? 'Could not hand over';
              }
            });
            root2.append(h('h2', {}, 'Hand over mission'),
              h('label', {}, 'Surveyor'), combo,
              h('p', { class: 'dialog-error field-error' }),
              h('div', { class: 'dialog-actions' }, go, h('button', { class: 'btn subtle', onclick: close }, 'Cancel')));
            combo.focus();
          });
        });
      }
      wrap.append(handover);
      // edit geofence
      const editFence = h('button', { class: 'btn subtle', disabled: !isOwner || !['Launched', 'Surveying'].includes(m.status) }, 'Edit geofence');
      if (isOwner && ['Launched', 'Surveying'].includes(m.status)) {
        editFence.addEventListener('click', () => {
          openModal({ label: 'Edit geofence' }, (root2, close) => {
            const text = h('textarea', { 'aria-label': 'Geofence corners', rows: '4' }) as HTMLTextAreaElement;
            text.value = m.geofence.map(p => `${p.easting}, ${p.northing}`).join('\n');
            const go = h('button', { class: 'btn primary' }, 'Save geofence');
            go.addEventListener('click', async () => {
              const fence = text.value.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
                const [e, n] = l.split(',').map(Number);
                return { easting: e, northing: n };
              });
              try {
                await apiFetch('PUT', `/api/missions/${m.id}/geofence`, { geofence: fence, version: m.version });
                close();
                announce('Geofence updated');
                await this.render();
              } catch (err) {
                const e2 = err as ApiError;
                const er = root2.querySelector('.dialog-error') as HTMLElement;
                if (er) er.textContent = e2.body?.errors?.geofence ?? e2.body?.message ?? 'Could not save the geofence';
              }
            });
            root2.append(h('h2', {}, 'Edit geofence'),
              h('label', {}, 'Geofence corners'), text,
              h('p', { class: 'dialog-error field-error' }),
              h('div', { class: 'dialog-actions' }, go, h('button', { class: 'btn subtle', onclick: close }, 'Cancel')));
            text.focus();
          });
        });
      }
      wrap.append(editFence);
      wrap.append(note);
    }
    return wrap;
  }
}
