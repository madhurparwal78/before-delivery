// The pen workspace: the 3D stage, the defect list, the editor and the copilot panel.

import { api, ApiError, NetworkError } from '../api';
import { h, clear, perceivedLen, fmtDec, reducedMotion, cameraDisplay, clockFromSeconds, utcStamp, setStatus, countWord, wrapBearing, hoursMinutes, pad2, alertIcon, btn } from '../ui';
import { openDialog, closeDialogOf, anyDialogOpen, closeTopDialog } from '../dialog';
import { onEvent, navigate, announce, copyForEvent, buildShell, openShortcuts } from '../main';
import { PenScene } from '../scene';
import * as T from '../types';

const NOTE_LIMIT = 500;

export class WorkspacePage {
  private penId: string;
  private pen: T.Pen | null = null;
  private scene: PenScene | null = null;
  private stageHost: HTMLElement | null = null;
  private pinLayer!: HTMLElement;
  private sceneStatus!: HTMLElement;
  private listEl!: HTMLElement;
  private emptyEl: HTMLElement | null = null;
  private editorHost!: HTMLElement;
  private copilotHost!: HTMLElement;

  // view state
  private view: 'cylinder' | 'flat' = 'cylinder';
  private selected: string | null = null;
  private marking = false;
  private markPoint: { x: number; y: number; z: number } | null = null;
  private loadedOnce = false;

  // editor state
  private editing: string | null = null;      // defect id or 'new'
  private editorData: EditorState | null = null;
  private lockTimer = 0;
  private toastTimer = 0;

  // copilot
  private copilotAnswer: T.CopilotAnswer | null = null;
  private copilotSeq = 0;

  private diveClockTimer = 0;
  private stopEvents: import("../main").EventUnsubscribe;
  private teardowns: (() => void)[] = [];
  private pens: T.Pen[] = [];

  constructor(app: HTMLElement, penId: string) {
    this.penId = penId;
    const { main } = buildShell(app, '/');
    this.root = main;
    this.stopEvents = onEvent((e) => this.onEvent(e));
    this.build();
    this.load();
    this.teardowns.push(() => this.stopEvents.clear());
  }

  private root: HTMLElement;

  teardown() {
    for (const fn of this.teardowns) fn();
    clearInterval(this.lockTimer);
    clearInterval(this.diveClockTimer);
    clearTimeout(this.toastTimer);
    this.scene?.dispose();
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKeys, true);
  }

  // ---------- structure ----------

  private build() {
    const phone = window.matchMedia('(max-width: 599px)').matches;
    const tablet = !phone && window.matchMedia('(max-width: 1099px)').matches;

    const wrap = h('div', { class: 'workspace gutters' });

    const penCol = h('div', { class: 'panel panel-pad col-scroll' });
    const stageCol = h('div');
    const copilotCol = h('div', { class: 'panel panel-pad col-scroll' });
    const defectsCol = h('div', { class: 'panel panel-pad col-scroll' });

    // pen list / picker
    this.penListHost = h('div');
    penCol.append(h('h2', { class: 'display-m', text: 'Pens', style: 'margin-bottom:8px' }), this.penListHost);

    // stage
    const stageWrap = h('div', { class: 'stage-wrap', role: 'region', 'aria-label': 'Pen stage' });
    this.stageHost = h('div', { style: 'position:absolute;inset:0' });
    this.pinLayer = h('div', { style: 'position:absolute;inset:0;pointer-events:none' });
    this.pinLayer.style.pointerEvents = 'none';
    const stageInner = h('div', { class: 'stage-h', style: 'pointer-events:none' });
    this.stageTitle = h('div', { class: 'stage-title' });
    this.sceneStatus = h('div', { class: 'scene-status num', role: 'status', 'aria-label': 'Scene status' });
    this.viewBtn = h('button', { class: 'btn', 'aria-label': 'Unwrap', text: 'Unwrap' });
    this.markBtn = h('button', { class: 'btn', 'aria-label': 'Mark defect', text: 'Mark defect' });
    const controls = h('div', { class: 'stage-controls', style: 'pointer-events:auto' }, this.viewBtn, this.markBtn);
    stageInner.append(this.stageTitle, this.sceneStatus);
    this.pinLayer.style.pointerEvents = 'auto'; // pins capture their own clicks
    stageWrap.append(this.stageHost, this.pinLayer, stageInner, controls);
    stageCol.append(stageWrap);

    if (phone) {
      stageWrap.style.minHeight = '40vh';
      stageWrap.style.height = '40vh';
    } else if (tablet) {
      stageWrap.style.minHeight = '52vh';
      stageWrap.style.height = '52vh';
    } else {
      stageWrap.style.height = 'calc(100vh - 84px)';
    }

    // defects panel
    this.listEl = h('div', { class: 'list', role: 'list', 'aria-label': 'Defect list' });
    this.defectsRegion = h('div', { role: 'region', 'aria-label': 'Defects' });
    this.editorHost = h('div', { class: 'editor' });
    this.editorHost.style.position = 'relative';
    defectsCol.append(this.defectsRegion, this.editorHost);

    // copilot panel
    this.copilotHost = h('div');
    copilotCol.append(h('h2', { class: 'display-m', text: 'Copilot', style: 'margin-bottom:8px' }), this.copilotHost);

    if (phone) {
      // phone: pen picker, stage, tabs, panels
      const picker = h('select', { 'aria-label': 'Pen', class: 'pen-picker' }) as HTMLSelectElement;
      this.penPicker = picker;
      this.tabHost = h('div', { class: 'phone-tabs', role: 'tablist', 'aria-label': 'Pen panels' });
      const tabDefs: [string, HTMLElement][] = [['Defects', defectsCol], ['Copilot', copilotCol], ['Pens', penCol]];
      const panels: HTMLElement[] = [];
      let i = 0;
      for (const [label, panel] of tabDefs) {
        panel.remove();
        const tab = h('button', { class: 'tab', role: 'tab', text: label, 'aria-selected': i === 0 ? 'true' : 'false', id: `tab-${i}`, tabindex: i === 0 ? '0' : '-1' });
        const tp = h('div', { role: 'tabpanel', 'aria-labelledby': `tab-${i}` });
        tp.append(panel);
        if (i > 0) tp.setAttribute('hidden', '');
        tab.addEventListener('click', () => {
          this.tabHost.querySelectorAll('.tab').forEach((t, j) => {
            t.setAttribute('aria-selected', 'false');
            t.setAttribute('tabindex', '-1');
            panels[j].setAttribute('hidden', '');
          });
          tab.setAttribute('aria-selected', 'true');
          tab.setAttribute('tabindex', '0');
          tp.removeAttribute('hidden');
        });
        this.tabHost.append(tab);
        panels.push(tp);
        i++;
      }
      wrap.append(picker, stageCol, this.tabHost);
      for (const p of panels) wrap.append(p);
    } else if (tablet) {
      wrap.append(penCol, stageCol);
      const lower = h('div', { class: 'panel panel-pad' });
      lower.append(defectsCol);
      wrap.append(lower);
      copilotCol.remove();
      wrap.append(copilotCol);
    } else {
      wrap.append(penCol, stageCol, copilotCol, defectsCol);
    }

    this.root.append(wrap);
    this.bindStageControls();
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKeys, true);
  }

  private penListHost!: HTMLElement;
  private penPicker: HTMLSelectElement | null = null;
  private tabHost!: HTMLElement;
  private stageTitle!: HTMLElement;
  private viewBtn!: HTMLButtonElement;
  private markBtn!: HTMLButtonElement;
  private defectsRegion!: HTMLElement;

  private onResize = () => {
    this.scene?.resize();
    this.scene?.renderOnce();
  };

  // ---------- stage controls and keys ----------

  private bindStageControls() {
    this.viewBtn.addEventListener('click', () => this.toggleView());
    this.markBtn.addEventListener('click', () => this.setMarking(!this.marking));
    // In marking mode, a tap on the net wall opens the New defect editor with that point.
    (this.stageHost!.parentElement as HTMLElement).addEventListener('click', (e) => {
      if (!this.marking || !this.scene) return;
      const target = e.target as HTMLElement;
      if (target.closest('.pin') || target.closest('button')) return;
      const pt = this.scene.wallPointAt(e.clientX, e.clientY);
      if (pt) this.onWallTap(pt.x, pt.y, pt.z);
    });
  }

  private onKeys = (e: KeyboardEvent) => {
    if (anyDialogOpen()) return;
    const t = e.target as HTMLElement;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
    const inTablist = t.closest('[role="tablist"]') !== null;
    const arrowsOnly = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (inTablist && arrowsOnly.includes(e.key)) {
      // The tab list owns those keys: they move focus among its tabs and select,
      // and never orbit the camera.
      this.handleTablistKeys(e);
      return;
    }

    if (!document.body.contains(this.stageHost ?? this.root)) return;
    switch (e.key) {
      case 'ArrowLeft': this.orbit(-15); e.preventDefault(); break;
      case 'ArrowRight': this.orbit(15); e.preventDefault(); break;
      case 'ArrowUp': this.tilt(10); e.preventDefault(); break;
      case 'ArrowDown': this.tilt(-10); e.preventDefault(); break;
      case '+': case '=': this.scene?.setZoom(this.scene.getZoom() + 0.25); this.refreshStatus(); break;
      case '-': this.scene?.setZoom(this.scene.getZoom() - 0.25); this.refreshStatus(); break;
      case 'u': case 'U': if (this.view === 'cylinder') this.toggleView(); break;
      case 'w': case 'W': if (this.view === 'flat') this.toggleView(); break;
      case 'n': case 'N': this.stepDefect(1); break;
      case 'p': case 'P': this.stepDefect(-1); break;
      case 'e': case 'E': if (this.selected) this.openEditor(this.selected); break;
      case 'm': case 'M': this.setMarking(!this.marking); break;
      case '?': openShortcuts(null); break;
    }
  };

  private handleTablistKeys(e: KeyboardEvent) {
    const list = (e.target as HTMLElement).closest('[role="tablist"]') as HTMLElement | null;
    if (!list) return;
    const tabs = Array.from(list.querySelectorAll<HTMLElement>('[role="tab"]'));
    const idx = tabs.findIndex(t => t.getAttribute('aria-selected') === 'true');
    let next = idx;
    switch (e.key) {
      case 'ArrowLeft': next = (idx - 1 + tabs.length) % tabs.length; break;
      case 'ArrowRight': next = (idx + 1) % tabs.length; break;
      case 'Home': next = 0; break;
      case 'End': next = tabs.length - 1; break;
      default: return;
    }
    e.preventDefault();
    (tabs[next] as HTMLElement).click();
    tabs[next].focus();
  }

  private orbit(delta: number) {
    if (!this.scene) return;
    if (this.view === 'flat') {
      // pan one panel left/right
      this.scene.setAzimuth(this.scene.getAzimuth() + delta);
    } else {
      this.scene.setAzimuth(this.scene.getAzimuth() + delta);
    }
    this.refreshStatus();
  }

  private tilt(delta: number) {
    if (!this.scene) return;
    if (this.view === 'flat') {
      this.scene.setTilt(this.scene.getTilt() + delta);
    } else {
      this.scene.setTilt(this.scene.getTilt() + delta);
    }
    this.refreshStatus();
  }

  private stepDefect(dir: 1 | -1) {
    const live = (this.pen?.defects ?? []).filter(d => !d.removed) as T.Defect[];
    if (!live.length) return;
    live.sort((a, b) => a.id.localeCompare(b.id));
    let idx = live.findIndex(d => d.id === this.selected);
    idx = idx === -1 ? (dir === 1 ? -1 : 0) : idx;
    const next = live[(idx + dir + live.length) % live.length];
    this.select(next.id, true);
  }

  // ---------- view ----------

  private toggleView() {
    if (!this.scene) return;
    const reduced = reducedMotion();
    if (this.view === 'cylinder') {
      this.scene.setAzimuth(0);
      this.scene.unwrap(reduced);
      this.view = 'flat';
    } else {
      this.scene.wrap(reduced);
      this.view = 'cylinder';
    }
    this.updateViewBtn();
    this.updateAddress();
    this.refreshStatus();
    this.renderList();
  }

  private updateViewBtn() {
    const focused = document.activeElement === this.viewBtn;
    // Without WebGL there is no run to play: the controls are absent.
    this.viewBtn.style.display = this.noWebgl ? 'none' : '';
    this.viewBtn.textContent = this.view === 'cylinder' ? 'Unwrap' : 'Wrap';
    this.viewBtn.setAttribute('aria-label', this.view === 'cylinder' ? 'Unwrap' : 'Wrap');
    if (focused) this.viewBtn.focus();
  }

  private updateAddress() {
    const url = new URL(location.href);
    const settled = !this.scene?.unwrapping;
    if (!settled) return;
    url.pathname = '/pens/' + this.penId;
    url.search = '';
    url.searchParams.set('view', this.view);
    if (this.selected) url.searchParams.set('defect', this.selected);
    history.replaceState(null, '', url.pathname + '?' + url.searchParams.toString());
  }

  // ---------- marking ----------

  private setMarking(on: boolean) {
    this.marking = on;
    this.markBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    this.scene?.setMarking(on);
    this.refreshStatus();
    if (!on && this.editing !== 'new') {
      // keep the half-filled editor alive; only leave marking mode
    }
  }

  // ---------- loading ----------

  private async load() {
    this.refreshStatus();
    try {
      const [pensRes, penRes] = await Promise.all([
        api.get<{ pens: T.Pen[] }>('/api/pens'),
        api.get<{ pen: T.Pen }>(`/api/pens/${this.penId}`),
      ]);
      this.pens = pensRes.pens;
      this.pen = penRes.pen;
      this.applyCanonicalAddress();
      this.buildPenList();
      this.buildStage();
      this.renderList();
      this.renderCopilotPanel();
      this.loadedOnce = true;
      this.startDiveClock();
      this.refreshStatus();
    } catch (e) {
      if (e instanceof NetworkError) announce(e.message);
    }
  }

  private applyCanonicalAddress() {
    const url = new URL(location.href);
    let view = url.searchParams.get('view');
    if (view !== 'cylinder' && view !== 'flat') view = 'cylinder';
    let defect = url.searchParams.get('defect');
    const known = this.pen?.defects.find(d => d.id === defect && !d.removed);
    if (!known) defect = null;

    // No WebGL: always the flat chart.
    const hasWebgl = (() => {
      try {
        const c = document.createElement('canvas');
        return !!(c.getContext('webgl2') || c.getContext('webgl'));
      } catch { return false; }
    })();
    if (!hasWebgl) view = 'flat';

    this.view = view as 'cylinder' | 'flat';
    this.selected = defect ?? null;

    if (!hasWebgl) this.noWebgl = true;

    const settledUrl = `/pens/${this.penId}?view=${this.view}` + (defect ? `&defect=${defect}` : '');
    history.replaceState(null, '', settledUrl);
  }

  private noWebgl = false;

  private buildPenList() {
    clear(this.penListHost);
    const list = h('div', { class: 'list', role: 'list', 'aria-label': 'Pens' });
    for (const p of this.pens) {
      const row = h('button', {
        class: 'row', role: 'link', text: p.name,
        'aria-pressed': p.id === this.penId ? 'true' : 'false',
        onclick: () => { try { localStorage.setItem('pensight-open-pen', p.id); } catch {} navigate('/pens/' + p.id); },
      });
      list.append(row);
    }
    this.penListHost.append(list);
    if (this.penPicker) {
      clear(this.penPicker);
      for (const p of this.pens) {
        const o = h('option', { value: p.id, text: p.name }) as HTMLOptionElement;
        if (p.id === this.penId) o.selected = true;
        this.penPicker.append(o);
      }
      this.penPicker.onchange = () => {
        const id = this.penPicker!.value;
        try { localStorage.setItem('pensight-open-pen', id); } catch {}
        navigate('/pens/' + id);
      };
    }
  }

  private buildStage() {
    if (!this.pen || !this.stageHost) return;
    this.stageTitle.textContent = this.pen.name;
    if (!this.scene) {
      this.scene = new PenScene(this.stageHost, this.pinLayer, {
        onMarkTap: (x, y, z) => this.onWallTap(x, y, z),
        onPinTap: (id) => this.select(id, true),
      });
      // when an Unwrap or Wrap run settles, the address records the settled view
      this.scene.onSettle = () => {
        this.updateAddress();
        this.refreshStatus();
        this.renderList();
        this.updateViewBtn();
      };
    }
    this.scene.setPen({
      circumference_m: this.pen.circumference_m,
      net_depth_m: this.pen.net_depth_m,
      columns: this.pen.grid.columns,
      rows: this.pen.grid.rows,
    });
    const ok = this.scene.ensureRenderer();
    this.noWebgl = !ok;
    if (!ok) {
      this.drawFlatFallback();
      this.updateViewBtn();
      return;
    }
    if (ok) {
      this.scene.start();
      this.scene.setPins((this.pen.defects as T.Defect[]).map(d => ({
        id: d.id, bearing: d.bearing_deg, depth: d.depth_m,
        chartX: d.chart_x_m, chartY: d.chart_y_m, removed: d.removed,
      })));
      this.scene.setSelected(this.selected);
      if (this.noWebgl || this.view === 'flat') {
        // Loading an address shows its end state in a single frame.
        this.scene.showFlat(true);
      }
    }
    this.updateViewBtn();
    // initial camera from the address
    if (this.selected) {
      const d = (this.pen.defects as T.Defect[]).find(x => x.id === this.selected);
      if (d) {
        if (this.view === 'cylinder') {
          this.scene?.setAzimuth(d.bearing_deg);
          this.scene?.flyRovToDefect(d.bearing_deg, d.depth_m, true);
        } else {
          this.scene?.flyRovToDefect(d.bearing_deg, d.depth_m, true);
        }
      }
    }
  }

  /** The metre-true flat chart drawn without WebGL: panel grid, labels and pins. */
  private drawFlatFallback() {
    if (!this.pen || !this.stageHost) return;
    let canvas = this.stageHost.querySelector('canvas.flat-fallback') as HTMLCanvasElement | null;
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.className = 'flat-fallback';
      canvas.style.position = 'absolute';
      canvas.style.inset = '0';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      this.stageHost.append(canvas);
    }
    const rect = this.stageHost.getBoundingClientRect();
    const w = Math.max(280, rect.width), hh = Math.max(200, rect.height);
    canvas.width = w * 2; canvas.height = hh * 2;
    const g = canvas.getContext('2d');
    if (!g) {
      // A 2D context is the last resort; without it the panel grid simply cannot draw,
      // but the pins still land at their chart positions.
      this.placeFallbackPins(w, hh);
      return;
    }
    g.scale(2, 2);
    g.fillStyle = '#04070a';
    g.fillRect(0, 0, w, hh);
    const cols = this.pen.grid.columns, rows = this.pen.grid.rows;
    const pw = w / cols, ph = hh / rows;
    g.strokeStyle = 'rgba(140,155,170,0.22)';
    for (let c = 0; c <= cols; c++) { g.beginPath(); g.moveTo(c * pw, 0); g.lineTo(c * pw, hh); g.stroke(); }
    for (let r = 0; r <= rows; r++) { g.beginPath(); g.moveTo(0, r * ph); g.lineTo(w, r * ph); g.stroke(); }
    g.fillStyle = '#8a93a0';
    g.font = '11px Inter, sans-serif';
    for (let c = 0; c < cols; c++) g.fillText(String.fromCharCode(65 + c), c * pw + 4, 12);
    for (let r = 0; r < rows; r++) g.fillText(String(r + 1), 4, r * ph + 24);
    // pins at their server chart positions
    this.placeFallbackPins(w, hh);
  }

  /** The flat-chart pins, shared by the no-WebGL chart. */
  private placeFallbackPins(w: number, hh: number) {
    if (!this.pen) return;
    this.pinLayer.querySelectorAll('.pin').forEach(el => el.remove());
    for (const d of this.pen.defects as T.Defect[]) {
      if (d.removed) continue;
      const x = (d.chart_x_m / this.pen.circumference_m) * w;
      const y = (d.chart_y_m / this.pen.net_depth_m) * hh;
      const btn = document.createElement('button');
      btn.className = 'pin';
      btn.setAttribute('aria-label', `Pin ${d.id}`);
      btn.style.left = x + 'px';
      btn.style.top = y + 'px';
      if (d.id === this.selected) btn.setAttribute('aria-pressed', 'true');
      btn.addEventListener('click', (e) => { e.stopPropagation(); this.select(d.id, true); });
      this.pinLayer.append(btn);
    }
  }

  private onWallTap(x: number, y: number, z: number) {
    if (!this.marking) return;
    this.markPoint = { x, y, z };
    this.setMarking(false);
    this.openNewEditor();
  }

  // ---------- defect selection ----------

  private select(id: string | null, fly = false) {
    this.selected = id;
    this.scene?.setSelected(id);
    if (id && fly) {
      const d = (this.pen?.defects as T.Defect[] | undefined)?.find(x => x.id === id);
      if (d && this.scene) {
        if (this.view === 'cylinder') {
          this.scene.glideToView(d.bearing_deg, this.scene.getTilt(), this.scene.getZoom());
        }
        this.scene.flyRovToDefect(d.bearing_deg, d.depth_m, reducedMotion());
      }
    }
    this.updateAddress();
    this.refreshStatus();
    // Update the pressed state in place so a double-click on a row is not interrupted.
    for (const row of Array.from(this.listEl.querySelectorAll('.row'))) {
      const rid = (row as HTMLElement).dataset.id;
      if (rid) row.setAttribute('aria-pressed', rid === id ? 'true' : 'false');
    }
  }

  // ---------- the defect list ----------

  private renderList() {
    if (!this.pen) return;
    const region = this.defectsRegion;
    clear(region);
    const heading = h('h2', { class: 'display-m', text: 'Defects', style: 'margin-bottom:6px' });
    const list = h('div', { class: 'list', role: 'list', 'aria-label': 'Defect list', id: 'defect-list' });
    region.append(heading, list);

    const defects = this.pen.defects;
    if (!defects.length) {
      region.append(h('div', { class: 'display-l', style: 'margin-top:24px', text: 'No defects marked on this pen' }));
      return;
    }
    for (const d of defects) {
      if (d.removed) {
        const row = h('button', {
          class: 'row', role: 'listitem',
          'aria-label': `${d.id}, Defect removed`,
          text: `${d.id} Defect removed`,
          onclick: () => {},
        });
        row.dataset.id = d.id;
        list.append(row);
        continue;
      }
      const dd = d as T.Defect;
      const repairedSuffix = dd.status === 'repaired' ? ' Repaired' : '';
      const text = this.view === 'flat'
        ? `${dd.id} ${dd.type} panel ${dd.cell}${repairedSuffix}`
        : `${dd.id} ${dd.type} ${fmtDec(dd.bearing_deg, 1)}° ${fmtDec(dd.depth_m, 1)} m${repairedSuffix}`;
      const row = h('button', {
        class: 'row', role: 'listitem',
        'aria-label': `${dd.id}, ${dd.type}`,
        'aria-pressed': dd.id === this.selected ? 'true' : 'false',
        onclick: () => this.select(dd.id, true),
        ondblclick: () => this.openEditor(dd.id),
      });
      row.dataset.id = dd.id;
      row.append(h('span', { text }));
      if (dd.lock) {
        row.append(h('span', { class: 'meta', text: `Being edited on ${dd.lock.device_name}` }));
      }
      list.append(row);
    }
  }

  // ---------- editor ----------

  private async openEditor(defectId: string) {
    try {
      const lock = await api.post<{ lock: T.Lock }>(`/api/defects/${defectId}/lock`);
      this.startLockRefresh(defectId);
      const res = await api.get<{ defect: T.Defect; }>(`/api/defects/${defectId}`);
      const hist = await api.get<{ history: T.HistoryEntry[] }>(`/api/defects/${defectId}/history`);
      this.editing = defectId;
      this.editorData = {
        defect: res.defect,
        history: hist.history,
        readOnly: lock.lock.device_id !== undefined && lock.lock.device_id !== (await import('../api')).deviceId(),
        lockedBy: lock.lock.device_id === (await import('../api')).deviceId() ? null : lock.lock.device_name,
      };
      this.renderEditor();
    } catch (e) {
      if (e instanceof ApiError && e.status === 423) {
        // another device holds the lock: open read-only with the lock line
        try {
          const res = await api.get<{ defect: T.Defect }>(`/api/defects/${defectId}`);
          const hist = await api.get<{ history: T.HistoryEntry[] }>(`/api/defects/${defectId}/history`);
          this.editing = defectId;
          this.editorData = {
            defect: res.defect, history: hist.history,
            readOnly: true,
            lockedBy: (e.details?.device_name as string) ?? 'another device',
          };
          this.renderEditor();
        } catch {}
      } else if (e instanceof NetworkError) {
        announce(e.message);
      }
    }
  }

  private openNewEditor() {
    this.editing = 'new';
    this.editorData = {
      newDefect: {
        type: 'hole',
        bearing: this.markPoint ? undefined : undefined,
        depth: undefined,
        wallPoint: this.markPoint,
        size: { width_cm: '', height_cm: '' },
        note: '', private_note: '',
      },
      readOnly: false, lockedBy: null,
    };
    this.renderEditor();
  }

  private startLockRefresh(defectId: string) {
    clearInterval(this.lockTimer);
    const session = defectId + ':' + Date.now();
    this.lockTimer = window.setInterval(() => {
      // A timer from an earlier session never refreshes a released lock:
      // only refresh while the same editor session is still open.
      if (this.editing !== defectId) { clearInterval(this.lockTimer); return; }
      api.post(`api/defects/${defectId}/lock`).then(() => {
        // lock refreshed
      }).catch((e) => {
        if (e instanceof ApiError && e.status === 423) {
          this.onLockLost();
        }
      });
    }, 10000);
  }

  private onLockLost() {
    if (!this.editorData) return;
    this.editorData.readOnly = true;
    this.editorData.lockLost = true;
    this.renderEditor();
  }

  private closeEditor(release = true) {
    const id = this.editing;
    this.editing = null;
    this.editorData = null;
    clearInterval(this.lockTimer);
    if (id && id !== 'new' && release) {
      api.del(`/api/defects/${id}/lock`).catch(() => {});
    }
    clear(this.editorHost);
    this.markPoint = null;
  }

  private renderEditor() {
    clear(this.editorHost);
    if (!this.editorData) return;
    const d = this.editorData;

    if (this.editing === 'new') {
      this.renderNewEditor();
      return;
    }
    if (!d.defect) return;

    const title = h('div', { class: 'display-m', text: `Edit ${d.defect.id}` });
    const status = h('div', { class: 'status num', role: 'status', 'aria-label': 'Editor status' });
    const region = h('div', { role: 'region', 'aria-label': 'Defect editor' });
    region.append(title);

    if (d.lockedBy) {
      region.append(h('div', { class: 'muted', text: `Being edited on ${d.lockedBy}` }));
    }
    if (d.lockLost) {
      status.textContent = 'Your edit lock expired — reopen the editor to continue';
    }

    const grid = h('div', { class: 'editor-grid' });
    const mk = (label: string, value: string, opts?: { num?: boolean }) => {
      const inp = h('input', { type: 'text', value, 'aria-label': label }) as HTMLInputElement;
      const wrap = h('div', { class: 'field' }, h('span', { class: 'label', text: label }), inp);
      if (opts?.num) inp.inputMode = 'decimal';
      return { wrap, inp };
    };

    const bearing = mk('Bearing (°)', fmtDec(d.defect.bearing_deg, 1), { num: true });
    const depth = mk('Depth (m)', fmtDec(d.defect.depth_m, 1), { num: true });
    grid.append(bearing.wrap, depth.wrap);

    // size fields by type
    const sizeFields: { key: keyof T.Size; label: string }[] = sizeKeysOf(d.defect.type);
    const sizeInputs: Record<string, HTMLInputElement> = {};
    for (const sf of sizeFields) {
      const v = String(d.defect.size[sf.key] ?? '');
      const f = mk(sf.label, v, { num: true });
      sizeInputs[sf.key as string] = f.inp;
      grid.append(f.wrap);
    }

    const note = mk('Note', d.defect.note) as { wrap: HTMLElement; inp: HTMLInputElement };
    const noteCount = h('span', { class: 'count num' });
    const setCount = () => { noteCount.textContent = `${perceivedLen(note.inp.value)} / ${NOTE_LIMIT}`; };
    note.inp.addEventListener('input', setCount); setCount();
    note.wrap.append(noteCount);
    const priv = mk('Private note', d.defect.private_note) as { wrap: HTMLElement; inp: HTMLInputElement };
    const privCount = h('span', { class: 'count num' });
    const setPrivCount = () => { privCount.textContent = `${perceivedLen(priv.inp.value)} / ${NOTE_LIMIT}`; };
    priv.inp.addEventListener('input', setPrivCount); setPrivCount();
    priv.wrap.append(privCount);
    note.wrap.classList.add('span2');
    priv.wrap.classList.add('span2');
    grid.append(note.wrap, priv.wrap);

    // read-only server values
    const server = h('div', { class: 'muted num', style: 'margin-top:4px' },
      `chart x ${fmtDec(d.defect.chart_x_m, 2)} m · chart y ${fmtDec(d.defect.chart_y_m, 2)} m · cell ${d.defect.cell} · ` +
      (d.defect.area_cm2 !== null ? `area ${fmtDec(d.defect.area_cm2, 0)} cm²` : `patch area ${fmtDec(d.defect.patch_area_m2 ?? 0, 1)} m²`)
    );
    grid.append(h('div', { class: 'span2' }, server));

    region.append(grid);

    // actions
    const save = h('button', { class: 'btn primary', text: 'Save' });
    const close = h('button', { class: 'btn', text: 'Close editor' });
    const del = h('button', { class: 'btn', text: 'Delete defect' });
    const ro = d.readOnly;
    save.disabled = ro; del.disabled = ro;
    close.addEventListener('click', () => this.closeEditor());
    del.addEventListener('click', (e) => this.confirmDelete(d.defect!.id, e.currentTarget as HTMLElement));

    save.addEventListener('click', async () => {
      save.disabled = true;
      setStatus(status, 'Saving…');
      try {
        const body: Record<string, unknown> = { version: d.defect!.version };
        const b = parseFloat(bearing.inp.value);
        if (!Number.isNaN(b)) body.bearing_deg = b;
        const dep = parseFloat(depth.inp.value);
        if (!Number.isNaN(dep)) body.depth_m = dep;
        const size: Record<string, number> = {};
        for (const [k, inp] of Object.entries(sizeInputs)) {
          const v = parseFloat(inp.value);
          if (!Number.isNaN(v)) size[k] = v;
        }
        if (Object.keys(size).length) body.size = size;
        body.note = note.inp.value;
        body.private_note = priv.inp.value;
        const res = await api.patch<{ defect: T.Defect; pen: T.Pen }>(`/api/defects/${d.defect!.id}`, body);
        this.pen = res.pen;
        this.applyPenUpdate();
        setStatus(status, `Saved ${d.defect!.id}`);
        // a toast that never hides a reopened editor: only clear the message, never the editor
        this.scheduleEditorStatusReset(status);
      } catch (err) {
        save.disabled = false;
        this.handleSaveError(err, status, d.defect!.id, note.inp, priv.inp, bearing.inp, depth.inp);
      }
    });

    // Enter in a single-line field saves
    for (const inp of [bearing.inp, depth.inp, ...Object.values(sizeInputs)]) {
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); save.click(); }
      });
    }

    // stills
    const stillsList = h('ul', { 'aria-label': 'Stills', style: 'list-style:none;padding:0;margin:8px 0' });
    for (const s of d.defect.stills) {
      stillsList.append(h('li', {},
        h('a', { href: `/api/stills/${s.id}/raw`, download: s.file_name, 'aria-label': `Download still ${s.id}`, text: `Download still ${s.id}` }),
      ));
    }
    const attach = h('button', { class: 'btn', text: 'Attach still' });
    attach.disabled = ro;
    attach.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/jpeg,image/png';
      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        if (!file) return;
        attach.disabled = true;
        setStatus(status, 'Uploading still…');
        try {
          const res = await api.upload<{ still: T.Still }>(`/api/defects/${d.defect!.id}/stills`, file, file.name);
          setStatus(status, `Attached still ${res.still.id}`);
          d.defect!.stills.push(res.still);
          clear(stillsList);
          for (const s of d.defect!.stills) {
            stillsList.append(h('li', {}, h('a', { href: `/api/stills/${s.id}/raw`, download: s.file_name, text: `Download still ${s.id}` })));
          }
          this.scheduleEditorStatusReset(status);
        } catch (err) {
          setStatus(status, err instanceof ApiError ? err.message : 'Upload failed', true);
        } finally {
          attach.disabled = false;
        }
      });
      input.click();
    });

    // repair
    const methodSel = h('select', { 'aria-label': 'Repair method' }) as HTMLSelectElement;
    for (const m of ['Patch', 'Lace', 'Replace panel', 'Clean']) {
      methodSel.append(h('option', { value: m.split(' ')[0].toLowerCase() === 'replace' ? 'replace_panel' : m.split(' ')[0].toLowerCase(), text: m }));
    }
    const repairNote = h('input', { type: 'text', 'aria-label': 'Repair note' }) as HTMLInputElement;
    const record = h('button', { class: 'btn', text: 'Record repair' });
    record.disabled = ro || d.defect.status === 'repaired';
    record.addEventListener('click', async () => {
      record.disabled = true;
      setStatus(status, 'Recording repair…');
      try {
        const method = methodSel.value as string;
        const res = await api.post<{ repair: T.Repair; defect: T.Defect; pen: T.Pen }>(`/api/defects/${d.defect!.id}/repairs`, {
          method: { 'Patch': 'patch', 'Lace': 'lace', 'Replace panel': 'replace_panel', 'Clean': 'clean' }[methodSel.selectedOptions[0]?.textContent as string] ?? method,
          note: repairNote.value,
        });
        this.pen = res.pen;
        this.applyPenUpdate();
        setStatus(status, `Repair recorded for ${d.defect!.id}`);
        this.scheduleEditorStatusReset(status);
      } catch (err) {
        record.disabled = false;
        setStatus(status, err instanceof ApiError ? err.message : 'Repair failed', true);
      }
    });

    // history
    const histList = h('ul', { 'aria-label': 'History', style: 'list-style:none;padding:0;margin:8px 0 0;font-size:13px' });
    for (const entry of d.history ?? []) {
      const lines = Object.entries(entry.changes ?? {}).map(([k, v]) =>
        `${k}: ${fmtValue(v.before)} → ${fmtValue(v.after)}`);
      histList.append(h('li', { class: 'muted', style: 'margin-bottom:6px' },
        `${utcStamp(entry.at)} · ${entry.device_name} · ${entry.action}` + (entry.detail ? ` · ${entry.detail}` : ''),
        ...(lines.length ? [h('div', { text: lines.join(' · ') })] : []),
      ));
    }

    region.append(status,
      h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:10px' }, save, close, del),
      h('h3', { class: 'display-m', style: 'margin-top:16px', text: 'Stills' }),
      attach, stillsList,
      h('h3', { class: 'display-m', style: 'margin-top:16px', text: 'Repair' }),
      h('div', { class: 'editor-grid' },
        h('div', { class: 'field' }, h('span', { class: 'label', text: 'Repair method' }), methodSel),
        h('div', { class: 'field' }, h('span', { class: 'label', text: 'Repair note' }), repairNote),
        h('div', { class: 'span2' }, record),
      ),
      h('h3', { class: 'display-m', style: 'margin-top:16px', text: 'History' }),
      histList,
    );

    this.editorHost.append(region);
  }

  /** Toast timers from an earlier session never overwrite the newer status text. */
  private scheduleEditorStatusReset(status: HTMLElement) {
    clearTimeout(this.toastTimer);
    const session = this.editing;
    this.toastTimer = window.setTimeout(() => {
      if (this.editing !== session) return;   // the editor was reopened; leave the new session's text
      status.textContent = '';
    }, 6000);
  }

  private handleSaveError(err: unknown, status: HTMLElement, id: string,
                          note: HTMLInputElement, priv: HTMLInputElement,
                          bearing: HTMLInputElement, depth: HTMLInputElement) {
    if (err instanceof ApiError) {
      if (err.status === 422 && err.fields) {
        setStatus(status, Object.values(err.fields)[0] ?? err.message, true);
        // field errors under their field
        for (const [field, msg] of Object.entries(err.fields)) {
          const target = field === 'note' ? note : field === 'private_note' ? priv
            : field === 'bearing_deg' ? bearing : field === 'depth_m' ? depth : null;
          if (target) {
            target.setAttribute('aria-invalid', 'true');
            const errEl = h('div', { class: 'err', style: 'font-size:12.5px' }, alertIcon(), msg);
            target.parentElement!.append(errEl);
          }
        }
      } else {
        setStatus(status, err.message, true);
      }
    } else if (err instanceof NetworkError) {
      setStatus(status, err.message, true);
    } else {
      setStatus(status, 'Save failed', true);
    }
  }

  private confirmDelete(defectId: string, opener: HTMLElement) {
    openDialog({
      title: 'Delete defect',
      initialFocus: 'cancel',
      body: (root) => {
        const status = h('div', { class: 'status' });
        const dlg = root.closest('dialog')!;
        root.append(h('p', { text: `Remove ${defectId}? The placeholder keeps its id.` }),
          status,
          h('div', { class: 'dialog-actions' },
            h('button', { class: 'btn', 'data-cancel': 'true', text: 'Cancel', onclick: () => closeDialogOf(dlg) }),
            h('button', {
              class: 'btn', text: 'Delete',
              onclick: async (e: Event) => {
                const btn = e.currentTarget as HTMLButtonElement;
                btn.disabled = true;
                setStatus(status, 'Removing…');
                try {
                  const res = await api.del<{ pen: T.Pen }>(`/api/defects/${defectId}`);
                  this.pen = res.pen;
                  closeDialogOf(dlg);
                  this.applyPenUpdate();
                  this.select(null);
                  const row = document.querySelector(`#defect-list .row[data-id="${defectId}"]`) as HTMLElement | null;
                  if (row) row.focus();
                } catch (err) {
                  btn.disabled = false;
                  setStatus(status, err instanceof ApiError ? err.message : 'Delete failed', true);
                }
              },
            }),
          ));
      },
    }, opener);
  }

  // ---------- new defect editor ----------

  private renderNewEditor() {
    const d = this.editorData!;
    const nd = d.newDefect!;
    const title = h('div', { class: 'display-m', text: 'New defect' });
    const status = h('div', { class: 'status num', role: 'status', 'aria-label': 'Editor status' });
    const region = h('div', { role: 'region', 'aria-label': 'Defect editor' });
    region.append(title, status);

    const grid = h('div', { class: 'editor-grid' });
    const typeSel = h('select', { 'aria-label': 'Type' }) as HTMLSelectElement;
    for (const t of ['hole', 'tear', 'chafe', 'fouling']) {
      const o = h('option', { value: t, text: t[0].toUpperCase() + t.slice(1) }) as HTMLOptionElement;
      typeSel.append(o);
    }
    typeSel.value = nd.type;
    grid.append(h('div', { class: 'field' }, h('span', { class: 'label', text: 'Type' }), typeSel));

    const bearing = h('input', { type: 'text', inputmode: 'decimal', 'aria-label': 'Bearing (°)' }) as HTMLInputElement;
    const depth = h('input', { type: 'text', inputMode: 'decimal', 'aria-label': 'Depth (m)' }) as HTMLInputElement;
    if (nd.wallPoint) {
      bearing.disabled = true;
      depth.disabled = true;
      bearing.value = '';
      bearing.placeholder = 'From the net wall';
      grid.append(
        h('div', { class: 'field' }, h('span', { class: 'label', text: 'Bearing (°)' }), bearing),
        h('div', { class: 'field' }, h('span', { class: 'label', text: 'Depth (m)' }), depth),
      );
    } else {
      grid.append(
        h('div', { class: 'field' }, h('span', { class: 'label', text: 'Bearing (°)' }), bearing),
        h('div', { class: 'field' }, h('span', { class: 'label', text: 'Depth (m)' }), depth),
      );
    }

    const sizeWrap = h('div', {});
    const renderSizeFields = () => {
      clear(sizeWrap);
      const keys = sizeKeysOf(typeSel.value as T.DefectType);
      const inputs: HTMLInputElement[] = [];
      for (const k of keys) {
        const inp = h('input', { type: 'text', inputmode: 'decimal', 'aria-label': k.label }) as HTMLInputElement;
        inputs.push(inp);
        sizeWrap.append(h('div', { class: 'field' }, h('span', { class: 'label', text: k.label }), inp));
      }
      return { inputs, keys };
    };
    let sizeState = renderSizeFields();
    typeSel.addEventListener('change', () => { sizeState = renderSizeFields(); });

    const note = h('input', { type: 'text', 'aria-label': 'Note' }) as HTMLInputElement;
    const noteCount = h('span', { class: 'count num' });
    const setCount = () => { noteCount.textContent = `${perceivedLen(note.value)} / ${NOTE_LIMIT}`; };
    note.addEventListener('input', setCount); setCount();
    const priv = h('input', { type: 'text', 'aria-label': 'Private note' }) as HTMLInputElement;
    const privCount = h('span', { class: 'count num' });
    const setPC = () => { privCount.textContent = `${perceivedLen(priv.value)} / ${NOTE_LIMIT}`; };
    priv.addEventListener('input', setPC); setPC();
    grid.append(
      h('div', { class: 'span2' }, h('div', { class: 'field' }, h('span', { class: 'label', text: 'Note' }), note, noteCount)),
      h('div', { class: 'span2' }, h('div', { class: 'field' }, h('span', { class: 'label', text: 'Private note' }), priv, privCount)),
    );
    region.append(grid, sizeWrap);

    const save = h('button', { class: 'btn primary', text: 'Save' });
    const close = h('button', { class: 'btn', text: 'Close editor' });
    close.addEventListener('click', () => this.closeEditor(false));
    save.addEventListener('click', async () => {
      save.disabled = true;
      setStatus(status, 'Saving…');
      const size: Record<string, number> = {};
      sizeState.inputs.forEach((inp, i) => {
        const v = parseFloat(inp.value);
        if (!Number.isNaN(v)) size[sizeState.keys[i].key as string] = v;
      });
      const body: Record<string, unknown> = {
        type: typeSel.value,
        size,
        note: note.value,
        private_note: priv.value,
      };
      if (nd.wallPoint) {
        body.wall_point = { x_m: nd.wallPoint.x, y_m: nd.wallPoint.y, z_m: nd.wallPoint.z };
      } else {
        const b = parseFloat(bearing.value);
        if (!Number.isNaN(b)) body.bearing_deg = b;
        const dep = parseFloat(depth.value);
        if (!Number.isNaN(dep)) body.depth_m = dep;
      }
      try {
        const res = await api.post<{ defect: T.Defect; pen: T.Pen }>(`/api/pens/${this.penId}/defects`, body);
        this.pen = res.pen;
        this.closeEditor(false);
        this.applyPenUpdate();
        this.select(res.defect.id);
        setStatus(status, `Saved ${res.defect.id}`);
      } catch (err) {
        save.disabled = false;
        if (err instanceof ApiError) setStatus(status, err.message, true);
        else if (err instanceof NetworkError) setStatus(status, err.message, true);
      }
    });

    region.append(h('div', { style: 'display:flex;gap:8px;margin-top:10px' }, save, close));
    this.editorHost.append(region);
    (sizeWrap.querySelector('input') as HTMLInputElement | null)?.focus();
  }

  // ---------- copilot ----------

  private renderCopilotPanel() {
    clear(this.copilotHost);
    const box = h('input', { type: 'text', 'aria-label': 'Ask the copilot', placeholder: 'Ask the copilot' }) as HTMLInputElement;
    const ask = h('button', { class: 'btn', text: 'Ask' });
    const status = h('div', { class: 'status num', role: 'status', 'aria-label': 'Copilot status' });
    const answer = h('div', { style: 'margin-top:10px' });
    const focusedList = h('div', {});
    const proposalsList = h('div', {});

    const submit = async () => {
      const q = box.value;
      const seq = ++this.copilotSeq;
      setStatus(status, 'Asking copilot…');
      this.copilotAnswer = null;
      this.refreshStatus();   // focus resets on a new question
      clear(answer); clear(focusedList); clear(proposalsList);
      try {
        const res = await api.post<{ answer: T.CopilotAnswer }>(`/api/pens/${this.penId}/copilot`, { question: q });
        if (seq !== this.copilotSeq) return;   // a newer question is in flight
        this.copilotAnswer = res.answer;
        setStatus(status, 'Copilot answered' + (res.answer.dropped_ids.length ? `. Ignored unknown defects: ${res.answer.dropped_ids.join(', ')}` : ''));
        answer.textContent = res.answer.text;
        // focused defects
        for (const id of res.answer.focus) {
          focusedList.append(h('button', {
            class: 'btn', text: `Show ${id}`,
            onclick: () => this.select(id, true),
          }));
        }
        for (const p of res.answer.proposals) {
          proposalsList.append(h('div', { class: 'proposal-row', style: 'margin-top:8px' },
            h('button', {
              class: 'btn', text: `Apply repair to ${p.defect_id}`,
              onclick: async (e: Event) => {
                const btn = e.currentTarget as HTMLButtonElement;
                btn.disabled = true;
                setStatus(status, 'Applying repair…');
                try {
                  await api.post(`/api/proposals/${p.id}/apply`);
                  setStatus(status, `Repair recorded for ${p.defect_id}`);
                } catch (err) {
                  btn.disabled = false;
                  if (err instanceof ApiError) setStatus(status, err.message, true);
                }
              },
            }),
          ));
        }
        if (res.answer.focus.length) {
          const first = (this.pen?.defects as T.Defect[] | undefined)?.find(d => d.id === res.answer.focus[0]);
          if (first) {
            this.select(res.answer.focus[0], true);
            this.sceneStatus;
          }
        }
        this.refreshStatus();
      } catch (err) {
        if (seq !== this.copilotSeq) return;
        if (err instanceof ApiError) setStatus(status, err.message, true);
        else if (err instanceof NetworkError) setStatus(status, err.message, true);
      }
    };

    ask.addEventListener('click', submit);
    box.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

    this.copilotHost.append(
      h('div', { class: 'field' }, box),
      ask, status, answer, focusedList, proposalsList,
    );
  }

  // ---------- scene status ----------

  private diveElapsed: number | null = null;

  private startDiveClock() {
    clearInterval(this.diveClockTimer);
    const tick = async () => {
      try {
        const res = await api.get<{ dives: T.Dive[] }>('/api/dives');
        const open = res.dives.find(d => d.pen_id === this.penId && d.status === 'started');
        this.diveElapsed = open ? (open.elapsed_s ?? 0) : null;
        if (open) this.diveStartedAt = Date.now() - (open.elapsed_s ?? 0) * 1000;
      } catch {}
      this.refreshStatus();
    };
    tick();
    this.diveClockTimer = window.setInterval(tick, 30000);
  }

  private diveStartedAt: number | null = null;

  private refreshStatus() {
    if (!this.sceneStatus) return;
    const lines: string[] = [];
    if (this.view === 'flat' && !this.scene?.unwrapping) lines.push('View: Flat chart');
    else if (this.view === 'cylinder' && !this.scene?.unwrapping) lines.push('View: Cylinder');
    else if (this.scene?.state === 'unwrapping') lines.push('View: Unwrapping');
    else if (this.scene?.state === 'wrapping') lines.push('View: Wrapping');
    else lines.push('View: ' + (this.view === 'flat' ? 'Flat chart' : 'Cylinder'));

    if (this.view === 'flat' && !this.scene?.unwrapping) lines.push('Camera: flat chart');
    else if (this.scene) lines.push(`Camera: ${cameraDisplay(this.scene.getAzimuth())}°`);
    if (this.scene) lines.push(`Zoom: ${this.scene.getZoom().toFixed(2)}×`);
    lines.push(`Selected: ${this.selected ?? 'none'}`);
    lines.push(`Focus: ${this.copilotAnswer ? (this.copilotAnswer.focus.length ? this.copilotAnswer.focus.join(', ') : 'none') : 'none'}`);
    if (this.diveElapsed !== null && this.diveStartedAt !== null) {
      const now = Date.now();
      lines.push(`Dive clock: ${clockFromSeconds((now - this.diveStartedAt) / 1000)}`);
    } else {
      lines.push('Dive clock: no dive running');
    }
    if (this.marking) lines.push('Marking: tap the net wall');
    if (!this.loadedOnce) lines.push('Loading pen');
    if (this.noWebgl) lines.push('3D view unavailable — showing the flat chart');
    this.sceneStatus.innerHTML = '';
    for (const l of lines) this.sceneStatus.append(h('div', { text: l }));
  }

  // ---------- live updates ----------

  private applyPenUpdate() {
    if (!this.pen || !this.scene) return;
    this.scene.setPins((this.pen.defects as T.Defect[]).map(d => ({
      id: d.id, bearing: d.bearing_deg, depth: d.depth_m,
      chartX: d.chart_x_m, chartY: d.chart_y_m, removed: d.removed,
    })));
    this.renderList();
    this.refreshStatus();
  }

  private onEvent(e: Record<string, unknown>) {
    const kind = e.kind as string;
    const penId = e.pen_id as string | undefined;
    if (penId && penId !== this.penId) {
      if (kind === 'defect_created' || kind === 'defect_updated') {
        // changes from other pens do not disturb this workspace
      }
      return;
    }
    // refresh this pen's data in place
    this.reloadPen();
    const copy = copyForEvent(e);
    if (copy) announce(copy);
  }

  private async reloadPen() {
    try {
      const res = await api.get<{ pen: T.Pen }>(`/api/pens/${this.penId}`);
      this.pen = res.pen;
      this.applyPenUpdate();
    } catch {}
  }
}

function sizeKeysOf(type: T.DefectType): { key: keyof T.Size; label: string }[] {
  switch (type) {
    case 'hole': return [{ key: 'width_cm', label: 'Width (cm)' }, { key: 'height_cm', label: 'Height (cm)' }];
    case 'tear': return [{ key: 'length_cm', label: 'Length (cm)' }, { key: 'gap_cm', label: 'Gap (cm)' }];
    case 'chafe': return [{ key: 'length_cm', label: 'Length (cm)' }, { key: 'width_cm', label: 'Width (cm)' }];
    case 'fouling': return [{ key: 'width_m', label: 'Width (m)' }, { key: 'height_m', label: 'Height (m)' }];
  }
}

function fmtValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

interface EditorState {
  defect?: T.Defect;
  newDefect?: {
    type: T.DefectType;
    bearing?: number;
    depth?: number;
    wallPoint: { x: number; y: number; z: number } | null;
    size: Record<string, unknown>;
    note: string;
    private_note: string;
  };
  history?: T.HistoryEntry[];
  readOnly: boolean;
  lockedBy: string | null;
  lockLost?: boolean;
}
