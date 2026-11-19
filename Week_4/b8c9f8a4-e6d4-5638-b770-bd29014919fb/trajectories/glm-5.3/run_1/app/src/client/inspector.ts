/** Inspector capture page: offline-capable queue shared across tabs. */
import { api, announce, clampUnit, londonStamp } from './lib.js';
import { PANELS, diagramRects, type PanelId } from './panels.js';

interface Panel { id: PanelId; label: string; substrate: string; owner: { microns: number; band: string } | null }
interface QueueRow {
  clientId: string;
  kind: 'reading' | 'finding';
  panelId: PanelId;
  microns?: number;
  u?: number;
  v?: number;
  wording?: string;
  capturedAt: string;
  state: 'Queued' | 'Sending' | 'Synced' | 'Rejected' | 'Conflict';
  reason?: string;
}

const QUEUE_KEY = 'ob-capture-queue';

function readQueue(): QueueRow[] {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]') as QueueRow[]; } catch { return []; }
}
function writeQueue(rows: QueueRow[]): void {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(rows));
  localStorage.setItem(QUEUE_KEY + '-tick', String(Date.now()));
}
function queueTick(): number {
  const tick = Number(localStorage.getItem(QUEUE_KEY + '-tick') ?? '0');
  return Number.isFinite(tick) ? tick : 0;
}

export function mountInspector(root: HTMLElement, token: string): void {
  root.innerHTML = `
    <div class="units-inline"><span>Units</span><button data-units></button></div>
    <main style="padding:22px;max-width:1080px;margin:0 auto">
      <h1 tabindex="-1">Inspector capture</h1>
      <p class="status-line" role="status" aria-label="Capture status" data-role="capture-status"></p>
      <div style="display:grid;gap:26px" data-role="layout">
        <div>
          <h2 id="capture-panels" tabindex="-1">Panels</h2>
          <list aria-label="Capture panels" data-role="panel-list" style="list-style:none;padding:0"></list>
        </div>
        <div>
          <h2 tabindex="-1">Capture</h2>
          <form class="notice-panel" data-role="capture-form" style="display:grid;gap:12px">
            <div class="field"><label for="capture-panel">Panel</label><select id="capture-panel" data-role="panel"></select></div>
            <div class="field"><label for="capture-microns">Microns</label><input id="capture-microns" type="number" min="1" max="2000" step="1" role="spinbutton" /></div>
            <button class="pill pill-light" type="button" data-role="queue-reading">Queue reading</button>
            <div data-role="diagram"></div>
            <div class="field"><label for="capture-note">Finding note</label><textarea id="capture-note" rows="2"></textarea></div>
            <button class="pill pill-light" type="button" data-role="queue-finding">Queue finding</button>
          </form>
          <button class="pill pill-solid" data-role="send-now" style="margin-top:16px">Send now</button>
          <h2 tabindex="-1" style="margin-top:36px">Queue</h2>
          <list aria-label="Capture queue" data-role="queue" style="list-style:none;padding:0"></list>
        </div>
      </div>
    </main>`;
  const main = root.querySelector('main') as HTMLElement;
  const statusEl = main.querySelector('[data-role="capture-status"]') as HTMLElement;
  const state = {
    panels: [] as Panel[],
    pin: { panelId: null as PanelId | null, u: 0.5, v: 0.5 },
    sending: false,
  };
  let units: 'microns' | 'mils' = localStorage.getItem('ob-units') === 'mils' ? 'mils' : 'microns';
  const unitsButton = root.querySelector('[data-units]') as HTMLButtonElement;
  unitsButton.textContent = units === 'microns' ? 'Units: microns' : 'Units: mils';
  unitsButton.addEventListener('click', () => {
    units = units === 'microns' ? 'mils' : 'microns';
    localStorage.setItem('ob-units', units);
    unitsButton.textContent = units === 'microns' ? 'Units: microns' : 'Units: mils';
    renderPanelList();
  });

  function figure(m: number): string {
    return units === 'mils' ? `${(Math.floor(m / 25.4 * 10 + 0.5) / 10).toFixed(1)} mils` : `${m} microns`;
  }

  async function loadPanels(): Promise<void> {
    const view = await api<{ panels: Panel[] }>(`/api/link/${token}`);
    state.panels = view.panels;
    renderPanelList();
    const select = main.querySelector('[data-role="panel"]') as HTMLSelectElement;
    select.replaceChildren(...PANELS.map(p => new Option(p.label, p.id)));
    renderDiagram();
  }

  function renderPanelList(): void {
    const list = main.querySelector('[data-role="panel-list"]') as HTMLElement;
    list.replaceChildren(...state.panels.map(panel => {
      const li = document.createElement('li');
      li.style.cssText = 'display:flex;justify-content:space-between;gap:10px;border-bottom:1px solid var(--surface);padding:10px 0;flex-wrap:wrap';
      const label = document.createElement('span');
      label.textContent = panel.label;
      const value = document.createElement('span');
      value.className = 'tabular';
      value.textContent = panel.owner ? figure(panel.owner.microns) : 'No reading';
      li.append(label, value);
      return li;
    }));
  }

  function renderDiagram(): void {
    const host = main.querySelector('[data-role="diagram"]') as HTMLElement;
    const size = 380;
    const rects = diagramRects(size);
    host.innerHTML = `
      <svg viewBox="0 0 ${size} ${size * 0.92}" width="100%" style="max-width:${size}px" role="img" aria-label="Panel diagram">
        ${rects.map(r => `<rect data-panel-id="${r.id}" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${r.id === state.pin.panelId ? '#cfd8ff' : '#e8e3f7'}" stroke="#7a74a8" stroke-width="1.5" style="cursor:pointer" />`).join('')}
        ${state.pin.panelId ? (() => {
          const rect = rects.find(r => r.id === state.pin.panelId)!;
          return `<circle cx="${rect.x + state.pin.u * rect.w}" cy="${rect.y + state.pin.v * rect.h}" r="6" fill="#c04a4a" />`;
        })() : ''}
      </svg>
      <button class="pill pill-light" data-role="pin" aria-label="Finding pin">Finding pin</button>`;
    host.querySelectorAll<SVGRectElement>('rect[data-panel-id]').forEach(rect => {
      rect.addEventListener('click', () => {
        const panelId = rect.getAttribute('data-panel-id') as PanelId;
        const r = rects.find(x => x.id === panelId)!;
        state.pin = {
          panelId,
          u: clampUnit(((event as MouseEvent).clientX - rect.getBoundingClientRect().left) / rect.getBoundingClientRect().width),
          v: 0.5,
        };
        void r;
        (main.querySelector('[data-role="panel"]') as HTMLSelectElement).value = panelId;
        renderDiagram();
      });
    });
    const pin = host.querySelector('[data-role="pin"]') as HTMLButtonElement;
    pin.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 0.05 : 0.01;
      if (!state.pin.panelId) return;
      if (e.key === 'ArrowLeft') { state.pin.u = clampUnit(state.pin.u - step); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { state.pin.u = clampUnit(state.pin.u + step); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { state.pin.v = clampUnit(state.pin.v - step); e.preventDefault(); }
      else if (e.key === 'ArrowDown') { state.pin.v = clampUnit(state.pin.v + step); e.preventDefault(); }
      else return;
      announce(statusEl, `Pin at ${(state.pin.u * 100).toFixed(0)}, ${(state.pin.v * 100).toFixed(0)} percent`);
      renderDiagram();
    });
  }

  function renderQueue(): void {
    const rows = readQueue();
    const list = main.querySelector('[data-role="queue"]') as HTMLElement;
    if (rows.length === 0) { list.innerHTML = '<li>Nothing queued</li>'; return; }
    list.replaceChildren(...rows.map(row => {
      const li = document.createElement('li');
      li.style.cssText = 'display:flex;justify-content:space-between;gap:10px;border-bottom:1px solid var(--surface);padding:10px 0;flex-wrap:wrap';
      const label = document.createElement('span');
      label.textContent = `${PANELS.find(p => p.id === row.panelId)?.label ?? row.panelId} — ${row.kind === 'reading' ? figure(row.microns ?? 0) : 'finding'}`;
      const word = document.createElement('span');
      word.textContent = row.reason ? `${row.state} — ${row.reason}` : row.state;
      li.append(label, word);
      return li;
    }));
  }

  async function sendBatch(): Promise<void> {
    if (state.sending) return;
    const rows = readQueue().filter(r => r.state === 'Queued' || r.state === 'Sending');
    if (rows.length === 0) return;
    state.sending = true;
    const batchId = crypto.randomUUID();
    rows.forEach(r => { r.state = 'Sending'; });
    writeQueue(readQueue().map(r => rows.find(s => s.clientId === r.clientId) ? { ...r, state: 'Sending' as const } : r));
    renderQueue();
    announce(statusEl, 'Sending queued items');
    try {
      const reply = await api<{ results: { clientId: string; state: string; errors?: Record<string, string> }[] }>(`/api/link/${token}/capture`, {
        method: 'POST',
        body: JSON.stringify({
          batchId,
          items: rows.map(r => ({
            clientId: r.clientId, kind: r.kind, panelId: r.panelId,
            microns: r.microns, u: r.u, v: r.v, wording: r.wording, capturedAt: r.capturedAt,
          })),
        }),
      });
      const byClient = new Map(reply.results.map(r => [r.clientId, r]));
      const all = readQueue();
      for (const row of all) {
        const result = byClient.get(row.clientId);
        if (!result) continue;
        if (result.state === 'applied' || result.state === 'duplicate') { row.state = 'Synced'; row.reason = undefined; }
        else if (result.state === 'conflict') row.state = 'Conflict';
        else { row.state = 'Rejected'; row.reason = Object.values(result.errors ?? {})[0] ?? 'Rejected'; }
      }
      writeQueue(all);
      renderQueue();
      announce(statusEl, 'All items synced');
      await loadPanels();
    } catch (err) {
      const all = readQueue().map(r => r.state === 'Sending' ? { ...r, state: 'Queued' as const } : r);
      writeQueue(all);
      renderQueue();
      const status = (err as { status?: number }).status;
      if (status === 404 || status === 410) {
        announce(statusEl, 'This link has ended, so these items were not saved.');
        const all2 = readQueue().map(r => r.state === 'Queued' ? { ...r, state: 'Rejected' as const, reason: 'link ended' } : r);
        writeQueue(all2);
        renderQueue();
      } else {
        announce(statusEl, 'No signal. Items stay queued on this device.');
      }
    } finally {
      state.sending = false;
    }
  }

  (main.querySelector('[data-role="queue-reading"]') as HTMLButtonElement).addEventListener('click', () => {
    const panelId = (main.querySelector('[data-role="panel"]') as HTMLSelectElement).value as PanelId;
    const microns = Number((main.querySelector('#capture-microns') as HTMLInputElement).value);
    const panel = PANELS.find(p => p.id === panelId);
    if (!panel || panel.substrate === 'plastic' || !Number.isInteger(microns) || microns < 1 || microns > 2000) {
      announce(statusEl, 'Enter whole microns from 1 to 2000 on a gaugeable panel');
      return;
    }
    const row: QueueRow = { clientId: crypto.randomUUID(), kind: 'reading', panelId, microns, capturedAt: new Date().toISOString(), state: 'Queued' };
    writeQueue([...readQueue(), row]);
    renderQueue();
    announce(statusEl, 'Reading queued');
  });

  (main.querySelector('[data-role="queue-finding"]') as HTMLButtonElement).addEventListener('click', () => {
    const panelId = (main.querySelector('[data-role="panel"]') as HTMLSelectElement).value as PanelId;
    const wording = (main.querySelector('#capture-note') as HTMLTextAreaElement).value;
    if (!state.pin.panelId || state.pin.panelId !== panelId) {
      state.pin.panelId = panelId;
      state.pin.u = 0.5;
      state.pin.v = 0.5;
    }
    if (wording.trim().length < 1 || wording.trim().length > 600) {
      announce(statusEl, 'Write a note of 1 to 600 characters');
      return;
    }
    const row: QueueRow = {
      clientId: crypto.randomUUID(), kind: 'finding', panelId,
      u: state.pin.u, v: state.pin.v, wording: wording.trim(),
      capturedAt: new Date().toISOString(), state: 'Queued',
    };
    writeQueue([...readQueue(), row]);
    renderQueue();
    announce(statusEl, 'Finding queued');
  });

  (main.querySelector('[data-role="send-now"]') as HTMLButtonElement).addEventListener('click', () => { void sendBatch(); });

  (main.querySelector('[data-role="panel"]') as HTMLSelectElement).addEventListener('change', (e) => {
    state.pin = { panelId: (e.target as HTMLSelectElement).value as PanelId, u: 0.5, v: 0.5 };
    renderDiagram();
  });

  window.addEventListener('online', () => void sendBatch());
  window.addEventListener('storage', (e) => { if (e.key === QUEUE_KEY || e.key === QUEUE_KEY + '-tick') renderQueue(); });
  // Rows appearing in another tab show within 2 seconds.
  setInterval(() => { if (queueTick() !== lastTick) { lastTick = queueTick(); renderQueue(); } }, 1000);
  let lastTick = queueTick();
  // Only one batch in flight across tabs: check the in-flight flag on a short interval.
  setInterval(() => { if (!state.sending && navigator.onLine && readQueue().some(r => r.state === 'Queued')) void sendBatch(); }, 4000);

  renderQueue();
  void loadPanels().catch(() => {
    announce(statusEl, 'No signal. Items stay queued on this device.');
  });
  void londonStamp;
}
