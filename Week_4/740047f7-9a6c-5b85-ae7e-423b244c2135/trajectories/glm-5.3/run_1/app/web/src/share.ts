// The farm manager's read-only report link page: the stage, the grade
// and the defect list, re-checked every 15 seconds against the server.

import { h, clear, utcStamp, utcDate, utcTime, hoursMinutes, perceivedLen, setStatus, countWord, clockFromSeconds } from './ui';
import { openShortcuts } from './share-shell';

interface PublicDefect {
  id: string; pen_id?: string; type?: string;
  bearing_deg?: number; depth_m?: number;
  chart_x_m?: number; chart_y_m?: number; cell?: string;
  note?: string; status?: string; removed?: boolean;
  repairs?: { method: string; note: string; recorded_at: string }[];
}

interface ShareJson {
  pen: { name: string; site_name: string; farm_name: string; circumference_m: number; net_depth_m: number; grid: { columns: number; rows: number } };
  grade: { letter: string; label: string };
  open_defects: number;
  max_fouling_cover_pct: number;
  latest_revision: { number: number; published_at: string } | null;
  defects: PublicDefect[];
  link: { status: string; expires_at: string; expires_in_s: number };
}

const token = location.pathname.split('/').pop() ?? '';

async function fetchShare(): Promise<{ status: number; body: ShareJson | null }> {
  try {
    const res = await fetch(`/api/share/${token}`, { headers: { 'Content-Type': 'application/json' } });
    if (!res.ok) return { status: res.status, body: null };
    return { status: 200, body: await res.json() };
  } catch {
    return { status: 0, body: null };
  }
}

function baseStatus(): string {
  const meta = document.querySelector('meta[name="share-status"]')?.getAttribute('content');
  return meta ?? 'active';
}

let selected: string | null = null;
let selectedTab: 'defects' | 'condition' = 'defects';
let current: ShareJson | null = null;

function renderGone(message: string) {
  const app = document.getElementById('app')!;
  clear(app);
  app.append(h('div', { class: 'topbar' },
    h('a', { class: 'wordmark', href: '/', 'aria-label': 'Pensight home', text: 'Pensight' }),
    h('span', { class: 'muted', style: 'margin-left:auto', text: 'Read-only report' }),
  ));
  app.append(h('div', { class: 'gone' }, h('h1', { text: message })));
}

function drawChart(canvas: HTMLCanvasElement, s: ShareJson, w: number, hh: number) {
  canvas.width = w * 2; canvas.height = hh * 2;
  const g = canvas.getContext('2d')!;
  g.scale(2, 2);
  g.fillStyle = '#04070a';
  g.fillRect(0, 0, w, hh);
  const cols = s.pen.grid.columns, rows = s.pen.grid.rows;
  const pw = w / cols, ph = hh / rows;
  g.strokeStyle = 'rgba(140,155,170,0.22)';
  for (let c = 0; c <= cols; c++) { g.beginPath(); g.moveTo(c * pw, 0); g.lineTo(c * pw, hh); g.stroke(); }
  for (let r = 0; r <= rows; r++) { g.beginPath(); g.moveTo(0, r * ph); g.lineTo(w, r * ph); g.stroke(); }
  g.fillStyle = '#8a93a0'; g.font = '10px Inter, sans-serif';
  for (let c = 0; c < cols; c++) g.fillText(String.fromCharCode(65 + c), c * pw + 3, 10);
  for (let r = 0; r < rows; r++) g.fillText(String(r + 1), 3, r * ph + 20);
  for (const d of s.defects) {
    if (d.removed || !d.chart_x_m || d.chart_y_m === undefined) continue;
    const x = (d.chart_x_m / s.pen.circumference_m) * w;
    const y = (d.chart_y_m / s.pen.net_depth_m) * hh;
    g.fillStyle = 'rgba(245,247,250,0.95)';
    g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fill();
  }
}

function expiryLine(s: ShareJson): string {
  const { h: hh, m } = hoursMinutes(s.link.expires_in_s);
  return `Link expires ${utcDate(s.link.expires_at)} ${utcTime(s.link.expires_at)} (in ${hh} h ${m} min)`;
}

function render(s: ShareJson) {
  const app = document.getElementById('app')!;
  clear(app);

  app.append(h('div', { class: 'topbar' },
    h('a', { class: 'wordmark', href: '/', 'aria-label': 'Pensight home', text: 'Pensight' }),
    h('span', { class: 'muted', style: 'margin-left:auto', text: 'Read-only report' }),
  ));

  const phone = window.matchMedia('(max-width: 599px)').matches;
  const grid = h('div', { class: 'share-grid gutters' });
  const stageWrap = h('div', { class: 'stage-wrap', role: 'region', 'aria-label': 'Pen stage', style: phone ? 'min-height:42vh' : 'min-height:70vh' });
  const sceneStatus = h('div', { class: 'scene-status num', role: 'status', 'aria-label': 'Scene status' });
  const pinLayer = h('div', { style: 'position:absolute;inset:0;pointer-events:auto' });
  const viewBtn = h('button', { class: 'btn', 'aria-label': 'Unwrap', text: 'Unwrap' });
  const controls = h('div', { class: 'stage-controls', style: 'pointer-events:auto' }, viewBtn);
  const canvasHost = h('div', { style: 'position:absolute;inset:0' });
  stageWrap.append(canvasHost, pinLayer, h('div', { class: 'stage-h', style: 'pointer-events:none' },
    h('div', { class: 'stage-title', text: s.pen.name }), sceneStatus), controls);

  const condition = h('div', { role: 'region', 'aria-label': 'Condition', class: 'panel panel-pad' });
  const defects = h('div', { role: 'region', 'aria-label': 'Defects', class: 'panel panel-pad' });

  const statusText = () => {
    const lines = ['View: ' + (view === 'flat' ? 'Flat chart' : 'Cylinder'), 'Focus: none'];
    sceneStatus.textContent = lines.join('\n');
  };
  let view: 'cylinder' | 'flat' = 'cylinder';

  // condition region
  condition.append(
    h('h2', { class: 'display-m', text: 'Condition' }),
    h('div', { class: 'display-l num' }, `Grade ${s.grade.letter} — ${s.grade.label}`),
    h('div', { class: 'muted num' }, countWord(s.open_defects, 'open defect', 'open defects')),
    h('div', { class: 'muted num' }, `Latest revision ${s.latest_revision ? s.latest_revision.number : '—'}${s.latest_revision ? ` · ${utcDate(s.latest_revision.published_at)}` : ''}`),
    h('div', { class: 'muted num', id: 'expiry' }, expiryLine(s)),
  );

  // defects region
  const buildDefects = () => {
    clear(defects);
    defects.append(h('h2', { class: 'display-m', text: 'Defects' }));
    const list = h('div', { class: 'list', role: 'list', 'aria-label': 'Defect list' });
    if (!s.defects.length) {
      defects.append(h('div', { class: 'display-l', style: 'margin-top:16px', text: 'No defects marked on this pen' }));
      return;
    }
    for (const d of s.defects) {
      if (d.removed) {
        list.append(h('div', { class: 'row', role: 'listitem', text: `${d.id} Defect removed` }));
        continue;
      }
      const text = view === 'flat'
        ? `${d.id} ${d.type} panel ${d.cell}`
        : `${d.id} ${d.type} ${d.bearing_deg!.toFixed(1)}° ${d.depth_m!.toFixed(1)} m` + (d.status === 'repaired' ? ' Repaired' : '');
      const row = h('button', {
        class: 'row', role: 'listitem', text,
        'aria-pressed': d.id === selected ? 'true' : 'false',
        onclick: () => { selected = d.id; buildDefects(); },
      });
      list.append(row);
    }
    defects.append(list);
  };
  buildDefects();

  if (phone) {
    const tabs = h('div', { class: 'phone-tabs', role: 'tablist', 'aria-label': 'Report panels' });
    const panels: HTMLElement[] = [];
    const defs: [string, HTMLElement][] = [['Defects', defects], ['Condition', condition]];
    defs.forEach(([label, panel], i) => {
      panel.remove();
      const tab = h('button', { class: 'tab', role: 'tab', text: label, 'aria-selected': (selectedTab === label.toLowerCase()) ? 'true' : 'false', id: 'rtab-' + i, tabindex: (selectedTab === label.toLowerCase()) ? '0' : '-1' });
      const tp = h('div', { role: 'tabpanel' });
      tp.append(panel);
      if (selectedTab !== label.toLowerCase()) tp.setAttribute('hidden', '');
      tab.addEventListener('click', () => {
        selectedTab = label.toLowerCase() as 'defects' | 'condition';
        tabs.querySelectorAll('.tab').forEach((t, j) => {
          t.setAttribute('aria-selected', 'false');
          t.setAttribute('tabindex', '-1');
          panels[j].setAttribute('hidden', '');
        });
        tab.setAttribute('aria-selected', 'true');
        tab.setAttribute('tabindex', '0');
        tp.removeAttribute('hidden');
      });
      tabs.append(tab);
      panels.push(tp);
    });
    grid.append(stageWrap, tabs, ...panels);
  } else {
    const right = h('div', {}, condition, h('div', { style: 'height:14px' }), defects);
    grid.append(stageWrap, right);
  }
  app.append(grid);

  // pins as simple buttons over the stage (flat chart drawing keeps it dependency-free)
  const chartCanvas = document.createElement('canvas');
  chartCanvas.style.width = '100%'; chartCanvas.style.height = '100%';
  chartCanvas.style.display = 'block';
  canvasHost.append(chartCanvas);
  const redraw = () => {
    const rect = stageWrap.getBoundingClientRect();
    drawChart(chartCanvas, s, Math.max(280, rect.width), Math.max(220, rect.height));
    pinLayer.querySelectorAll('.pin').forEach(p => p.remove());
    for (const d of s.defects) {
      if (d.removed || !d.chart_x_m || d.chart_y_m === undefined) continue;
      const rect2 = stageWrap.getBoundingClientRect();
      const x = (d.chart_x_m / s.pen.circumference_m) * rect2.width;
      const y = (d.chart_y_m / s.pen.net_depth_m) * rect2.height;
      const btn = h('button', { class: 'pin', 'aria-label': `Pin ${d.id}` }) as HTMLButtonElement;
      btn.style.left = x + 'px'; btn.style.top = y + 'px';
      if (d.id === selected) btn.setAttribute('aria-pressed', 'true');
      btn.addEventListener('click', () => { selected = d.id; buildDefects(); redraw(); });
      pinLayer.append(btn);
    }
  };
  viewBtn.addEventListener('click', () => {
    view = view === 'cylinder' ? 'flat' : 'cylinder';
    viewBtn.textContent = view === 'cylinder' ? 'Unwrap' : 'Wrap';
    viewBtn.setAttribute('aria-label', viewBtn.textContent as string);
    statusText();
    buildDefects();
  });
  statusText();

  requestAnimationFrame(redraw);
  window.addEventListener('resize', redraw);

  // ? opens the shortcuts dialog here too
  document.addEventListener('keydown', (e) => {
    if (e.key === '?') {
      const t = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
      e.preventDefault();
      openShortcuts(null);
    }
  });
}

async function boot() {
  const initial = baseStatus();
  if (initial === 'missing') { renderGone('This report link does not exist'); return; }
  if (initial === 'inactive') { renderGone('This report link is no longer active'); return; }
  const first = await fetchShare();
  if (first.status === 404) { renderGone('This report link does not exist'); return; }
  if (first.status === 410) { renderGone('This report link is no longer active'); return; }
  if (first.status !== 200 || !first.body) {
    renderGone('This report link does not exist');
    return;
  }
  current = first.body;
  render(first.body);
  setInterval(async () => {
    const res = await fetchShare();
    if (res.status === 404) { renderGone('This report link does not exist'); return; }
    if (res.status === 410) { renderGone('This report link is no longer active'); return; }
    if (res.status === 200 && res.body) {
      current = res.body;
      render(res.body);   // updates only what changed; state is re-applied by render
    }
  }, 15000);
}

boot();
