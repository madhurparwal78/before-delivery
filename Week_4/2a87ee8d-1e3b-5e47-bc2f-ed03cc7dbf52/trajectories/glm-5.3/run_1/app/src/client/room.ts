/**
 * The room: board rendering, the live stream, notes, clusters, dots, the drawer
 * and the facilitator controls. Roles and accessible names follow the brief.
 */
import { api, newClientOpId, errorMessage, errorCode } from './api.js';
import { el, h, iconBtn, liveRegions, announceActivity, announceProblem, openDialog, LiveRegions } from './ui.js';
import { escapeHtml, hhmm } from './polyfill.js';
import { STATUS_LABELS, PLAN_LABELS, TERM_LABELS, type WorkshopStatus } from '../domain.js';

export interface ShapedNote {
  id: string; frameId: string; clusterId: string | null; kind: string;
  text: string | null; imageUrl: string | null; x: number; y: number;
  revealed: boolean; mine: boolean; authorName?: string; facilitatorOnly?: boolean;
}
export interface ShapedCluster {
  id: string; frameId: string; title: string; x: number; y: number;
  noteIds: string[]; noteCount: number; myDots?: number; dotTotal?: number;
}
export interface ShapedFrame {
  id: string; title: string; x: number; y: number; width: number; height: number;
  position: number; noteCount: number; hiddenCount: number;
}
export interface BoardData {
  serverTime: string;
  workshop: Record<string, unknown>;
  viewer: { role: 'facilitator' | 'participant'; name?: string; participantId?: string; displayName?: string; dotsRemaining?: number | null };
  frames: ShapedFrame[];
  clusters: ShapedCluster[];
  notes: ShapedNote[];
  connectors: Array<{ id: string; fromNoteId: string; toNoteId: string }>;
  participants?: Array<{ id: string; displayName: string; notesThisRound: number; active: boolean }>;
}

interface ZoomState { x: number; y: number; k: number }

let regions: LiveRegions;
let board: BoardData | null = null;
let lastBoard: BoardData | null = null;
let lastStreamDown = false;
let stream: EventSource | null = null;
let zoom: ZoomState = { x: 0, y: 0, k: 1 };
let serverClockOffset = 0;
let saveInFlight = false;
let pickedUpId: string | null = null;

export function renderRoom(app: HTMLElement, workshopId: string, opts: { ended?: boolean }): void {
  regions = liveRegions();
  app.innerHTML = '';
  if (opts.ended) {
    app.appendChild(el(`<main class="page"><h1>This join link is no longer active. Ask your facilitator for a new one.</h1></main>`));
    return;
  }
  const root = el(`<div class="room">
    <header class="topbar">
      <h1 id="room-title"></h1>
      <span class="badge live" id="room-status"></span>
      <button id="btn-frames" class="ghost">Frames</button>
      <button id="btn-session" class="ghost">Session</button>
      <search role="search" class="searchbox" id="searchbox">
        <input type="search" id="search-input" placeholder="Search notes" aria-label="Search notes">
      </search>
      <div class="connecting-note" id="conn-note" hidden>Reconnecting to the board…</div>
    </header>
    <nav class="rail" id="rail" aria-label="Frames">
      <h2>Frames</h2>
      <div id="rail-frames" role="navigation" aria-label="Frames"></div>
    </nav>
    <main class="board-area" id="board-area">
      <div class="board-viewport" id="viewport"></div>
      <div class="canvas-toolbar" id="toolbar" role="toolbar" aria-label="Board tools"></div>
      <div id="search-panel" class="search-panel" hidden></div>
    </main>
    <aside class="drawer" id="drawer" aria-label="Session">
      <h2>Session</h2>
      <div id="drawer-body"></div>
    </aside>
  </div>`);
  app.appendChild(root);
  app.appendChild(regions.activity);
  app.appendChild(regions.problems);

  buildToolbar();
  wireSearch();
  wireSheets();
  void loadBoard(workshopId, true);
  openStream(workshopId);
}

async function loadBoard(workshopId: string, first: boolean): Promise<void> {
  const res = await api<BoardData & { error?: unknown }>('GET', `/api/workshops/${workshopId}/board`);
  if (res.networkError) return;
  if (res.status === 401 && errorCode(res.body as { error?: { code?: string } }) === 'session_ended') {
    renderRoom(appEl(), workshopId, { ended: true });
    return;
  }
  if (res.status !== 200) {
    if (res.status === 401 || res.status === 403) {
      window.location.hash = '#/';
      return;
    }
    return;
  }
  const data = res.body as BoardData;
  serverClockOffset = Date.parse(data.serverTime) - Date.now();
  const prev = lastBoard;
  board = data;
  renderBoard();
  if (first) {
    // fit board and set entrance animations
    fitBoard();
  }
  maybeRevealWave(prev, data);
  lastBoard = data;
}

function appEl(): HTMLElement {
  return document.getElementById('app') as HTMLElement;
}

function openStream(workshopId: string): void {
  const connect = (): void => {
    stream?.close();
    const es = new EventSource(`/api/workshops/${workshopId}/stream`);
    stream = es;
    es.addEventListener('open', () => {
      document.getElementById('conn-note')?.setAttribute('hidden', '');
    });
    es.addEventListener('error', () => {
      if (es.readyState === EventSource.CLOSED) {
        document.getElementById('conn-note')?.removeAttribute('hidden');
        lastStreamDown = true;
        setTimeout(connect, 2500);
      }
    });
    es.addEventListener('board', () => {
      void loadBoard(workshopId, false);
    });
    es.addEventListener('ended', () => {
      renderRoom(appEl(), workshopId, { ended: true });
    });
    es.addEventListener('presence', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as { cursorId: string; hue: number; x: number; y: number; name?: string };
        drawCursor(data);
      } catch { /* ignore */ }
    });
  };
  connect();
}

const cursors = new Map<string, { el: HTMLElement; at: number }>();
function drawCursor(data: { cursorId: string; hue: number; x: number; y: number; name?: string }): void {
  const viewport = document.getElementById('viewport');
  if (!viewport) return;
  let entry = cursors.get(data.cursorId);
  if (!entry) {
    const node = el(`<div class="cursor-dot" aria-hidden="true"></div>`);
    node.innerHTML = `<div class="halo" style="background: radial-gradient(circle, hsla(${data.hue},70%,60%,0.45), hsla(${data.hue},70%,60%,0) 70%)"></div><div class="pointer"></div>${data.name ? `<div class="name">${escapeHtml(data.name)}</div>` : ''}`;
    viewport.appendChild(node);
    entry = { el: node, at: Date.now() };
    cursors.set(data.cursorId, entry);
  }
  entry.at = Date.now();
  entry.el.style.transform = `translate(${data.x}px, ${data.y}px)`;
}

function buildToolbar(): void {
  const toolbar = document.getElementById('toolbar') as HTMLElement;
  toolbar.replaceChildren(
    toolBtn('Add note', 'plus', () => openNoteEditor()),
    toolBtn('Add image', 'image', () => pickImage()),
    toolBtn('Add cluster', 'cluster', () => openClusterEditor()),
    toolBtn('Connect notes', 'link', () => toggleConnectMode()),
    toolBtn('Zoom out', 'zoomOut', () => stepZoom(-1)),
    toolBtn('Zoom in', 'zoomIn', () => stepZoom(1)),
    toolBtn('Fit board', 'fit', () => fitBoard()),
  );
}

function toolBtn(label: string, icon: string, onClick: () => void): HTMLButtonElement {
  const b = iconBtn(icon, label, onClick);
  b.title = label;
  return b;
}

function wireSearch(): void {
  const input = document.getElementById('search-input') as HTMLInputElement;
  const panel = document.getElementById('search-panel') as HTMLElement;
  let timer: number | undefined;
  let lastQuery = '';
  input.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void runSearch(), 330);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      window.clearTimeout(timer);
      void runSearch();
    }
    if (e.key === 'Escape') {
      input.value = '';
      panel.hidden = true;
      input.focus();
    }
  });
  async function runSearch(): Promise<void> {
    const q = input.value.trim();
    if (q.length === 0) { panel.hidden = true; return; }
    if (!board) return;
    const wid = (board.workshop as { id: string }).id;
    panel.innerHTML = '<div class="muted" id="searching">Searching…</div>';
    panel.hidden = false;
    const res = await api<{ results: Array<{ noteId: string; frameId: string; text: string }> }>('GET', `/api/workshops/${wid}/search?q=${encodeURIComponent(q)}`);
    const searching = document.getElementById('searching');
    if (searching) searching.remove();
    if (res.status !== 200) return;
    const list = h('ul', { id: 'search-results', 'aria-label': 'Search results' });
    if (res.body.results.length === 0) {
      panel.appendChild(h('div', { class: 'muted' }, `No notes match “${q}”.`));
    }
    for (const r of res.body.results) {
      const li = h('li');
      const btn = h('button', {}, r.text) as HTMLButtonElement;
      btn.addEventListener('click', () => {
        centreOnNote(r.noteId);
        panel.hidden = true;
        input.value = '';
      });
      li.appendChild(btn);
      list.appendChild(li);
    }
    panel.appendChild(list);
    void lastQuery;
  }
  void panel;
}

function wireSheets(): void {
  const framesBtn = document.getElementById('btn-frames');
  const sessionBtn = document.getElementById('btn-session');
  const rail = document.getElementById('rail');
  const drawer = document.getElementById('drawer');
  framesBtn?.addEventListener('click', () => {
    if (window.innerWidth >= 1024) return;
    rail?.classList.toggle('sheet-open');
    drawer?.classList.remove('sheet-open');
  });
  sessionBtn?.addEventListener('click', () => {
    if (window.innerWidth >= 1024) return;
    drawer?.classList.toggle('sheet-open');
    rail?.classList.remove('sheet-open');
  });
}

function renderBoard(): void {
  if (!board) return;
  const viewport = document.getElementById('viewport');
  if (!viewport) return;
  const workshop = board.workshop as { id: string; title: string; status: WorkshopStatus; round?: { number: number; endsAt: string } | null; voting?: { dotBudget: number; endsAt: string } | null; version: number };
  const title = document.getElementById('room-title');
  if (title) title.textContent = workshop.title;
  const statusEl = document.getElementById('room-status');
  if (statusEl) statusEl.textContent = STATUS_LABELS[workshop.status] ?? workshop.status;
  viewport.replaceChildren();
  const notesByFrame = new Map<string, ShapedNote[]>();
  for (const n of board.notes) {
    const arr = notesByFrame.get(n.frameId) ?? [];
    arr.push(n);
    notesByFrame.set(n.frameId, arr);
  }
  for (const frame of board.frames) {
    viewport.appendChild(renderFrame(frame, notesByFrame.get(frame.id) ?? []));
  }
  applyZoom();
  renderRail();
  renderDrawer();
}

function renderFrame(frame: ShapedFrame, notes: ShapedNote[]): HTMLElement {
  const region = el(`<section class="board-frame" role="region" aria-label="${escapeHtml(frame.title)}" data-frame="${frame.id}" style="left:${frame.x}px; top:${frame.y}px; width:${frame.width}px; height:${frame.height}px">
    <header><h2>${escapeHtml(frame.title)}</h2><span class="frame-count">${frame.hiddenCount > 0 ? `${frame.hiddenCount} hidden` : frame.noteCount === 1 ? '1 note' : `${frame.noteCount} notes`}</span></header>
  </section>`) as HTMLElement;
  const heading = region.querySelector('h2') as HTMLElement;
  heading.setAttribute('tabindex', '-1');
  const clusters = board?.clusters.filter((c) => c.frameId === frame.id) ?? [];
  for (const cluster of clusters) {
    region.appendChild(renderCluster(cluster));
  }
  for (const note of notes.filter((n) => n.clusterId === null)) {
    region.appendChild(renderNote(note));
  }
  if (board?.viewer.role === 'facilitator') {
    const frameHeader = region.querySelector('header') as HTMLElement;
    const options = h('button', { class: 'ghost', 'aria-label': 'Frame options' }, '⋮') as HTMLButtonElement;
    options.addEventListener('click', () => openFrameMenu(frame));
    frameHeader.appendChild(options);
  }
  return region;
}

function renderCluster(cluster: ShapedCluster): HTMLElement {
  const group = el(`<div class="cluster" role="group" aria-label="Cluster: ${escapeHtml(cluster.title)}" style="left:${cluster.x}px; top:${cluster.y}px">
    <h3>${escapeHtml(cluster.title)}</h3>
    <span class="cluster-count">${cluster.noteCount === 1 ? '1 note' : `${cluster.noteCount} notes`}</span>
  </div>`) as HTMLElement;
  const notesIn = board?.notes.filter((n) => n.clusterId === cluster.id) ?? [];
  const list = h('ul');
  list.style.position = 'absolute';
  list.style.top = '30px';
  for (const n of notesIn) {
    const li = h('li');
    li.style.position = 'relative';
    li.appendChild(renderNote(n));
    list.appendChild(li);
  }
  group.appendChild(list);
  if (board?.viewer.role === 'participant' && board.workshop && (board.workshop as { status: string }).status === 'voting') {
    const bar = el('<div class="cluster-toolbar"></div>');
    const add = h('button', { 'aria-label': `Add dot to ${cluster.title}` }, 'Add dot') as HTMLButtonElement;
    const remove = h('button', { 'aria-label': `Remove dot from ${cluster.title}` }, 'Remove dot') as HTMLButtonElement;
    add.addEventListener('click', () => void spendDot(cluster, add));
    remove.addEventListener('click', () => void returnDot(cluster, remove));
    bar.appendChild(add);
    bar.appendChild(remove);
    bar.appendChild(h('span', { class: 'mono' }, `${cluster.myDots ?? 0} of yours`));
    group.appendChild(bar);
  }
  return group;
}

function renderNote(note: ShapedNote): HTMLElement {
  const canRead = note.text !== null;
  if (!canRead) {
    // a card back: outline only, no text nodes at all
    const back = el(`<button class="card-back" style="left:${note.x}px; top:${note.y}px" aria-label="${note.authorName ? `Hidden note by ${escapeHtml(note.authorName)}` : 'Hidden note'}" data-note="${note.id}"></button>`) as HTMLElement;
    if (note.authorName && board?.viewer.role === 'facilitator') {
      back.appendChild(h('span', { class: 'author' }, note.authorName));
    }
    back.addEventListener('dblclick', () => void 0);
    return back;
  }
  if (note.kind === 'image') {
    const img = el(`<button class="sticky image" style="left:${note.x}px; top:${note.y}px" aria-label="Image note" data-note="${note.id}"><img src="${note.imageUrl ?? ''}" alt=""></button>`) as HTMLElement;
    if (!note.revealed && note.mine) img.setAttribute('aria-label', `Your note`);
    return img;
  }
  const name = note.facilitatorOnly
    ? `Facilitator-only note: ${note.text}`
    : note.revealed ? `Note: ${note.text}`
    : note.mine ? `Your note: ${note.text}` : 'Hidden note';
  const sticky = el(`<button class="sticky" style="left:${note.x}px; top:${note.y}px" aria-label="${escapeHtml(name)}" data-note="${note.id}">${escapeHtml(note.text ?? '')}</button>`) as HTMLElement;
  if (note.facilitatorOnly) sticky.classList.add('fac-only');
  wireNoteInteractions(sticky);
  return sticky;
}

function wireNoteInteractions(node: HTMLElement): void {
  node.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') openNoteEditor(node.dataset.note ?? '');
    if (e.key === ' ' ) { e.preventDefault(); pickUp(node.dataset.note ?? ''); }
    if (e.key === 'm' || e.key === 'M') openMoveDialog(node.dataset.note ?? '');
  });
  node.addEventListener('dblclick', () => openNoteEditor(node.dataset.note ?? ''));
  let drag: { startX: number; startY: number; moved: boolean } | null = null;
  node.addEventListener('pointerdown', (ev) => {
    drag = { startX: ev.clientX, startY: ev.clientY, moved: false };
  });
  node.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    const dx = ev.clientX - drag.startX;
    const dy = ev.clientY - drag.startY;
    if (Math.abs(dx) + Math.abs(dy) > 3) {
      drag.moved = true;
      node.style.transform = `translate(${dx / zoom.k}px, ${dy / zoom.k}px) scale(1.04)`;
      node.classList.add('lifting');
    }
  });
  node.addEventListener('pointerup', () => {
    if (!drag) return;
    const rect = node.getBoundingClientRect();
    const moved = drag.moved;
    const base = { x: parseFloat(node.style.left), y: parseFloat(node.style.top) };
    drag = null;
    node.classList.remove('lifting');
    node.style.transform = '';
    if (!moved) return;
    void saveMove(node.dataset.note ?? '', rect, base);
  });
}

async function saveMove(noteId: string, rect: DOMRect, base: { x: number; y: number }): Promise<void> {
  if (!board) return;
  const wid = (board.workshop as { id: string }).id;
  const x = base.x + (rect.left - base.x * zoom.k) / zoom.k;
  void x;
  const viewport = document.getElementById('board-area');
  if (!viewport) return;
  const area = viewport.getBoundingClientRect();
  const nx = (rect.left - area.left + area.width / 2) / zoom.k - zoom.x - 76;
  const ny = (rect.top - area.top + area.height / 2) / zoom.k - zoom.y - 40;
  const res = await api(`PATCH`, `/api/notes/${noteId}`, {
    clientOpId: newClientOpId(),
    position: { x: Math.round(nx), y: Math.round(ny) },
  }, { retry: true });
  if (res.status !== 200) {
    announceProblem(regions, `Move not saved — ${res.networkError ? "you're offline" : errorMessage(res.body as never)}. The note is back where everyone else sees it.`);
    void loadBoard(wid, false);
  }
}

function pickUp(noteId: string): void {
  pickedUpId = noteId;
  announceActivity(regions, 'Picked up. Up and down arrows reorder, M moves to another cluster or frame, Space drops, Escape cancels.');
}

function openMoveDialog(noteId: string): void {
  if (!board) return;
  const note = board.notes.find((n) => n.id === noteId);
  if (!note) return;
  openDialog({ label: 'Move note', onOpen: (dialog) => {
    dialog.innerHTML = `<h2>Move note</h2>`;
    const listbox = h('div', { role: 'listbox', 'aria-label': 'Destinations' });
    for (const cluster of board?.clusters ?? []) {
      const frame = board?.frames.find((f) => f.id === cluster.frameId);
      const option = h('div', { role: 'option', tabindex: '0', 'aria-selected': 'false', 'data-target': `cluster:${cluster.id}` }, `Cluster: ${cluster.title} (${frame?.title ?? ''})`);
      listbox.appendChild(option);
    }
    for (const frame of board?.frames ?? []) {
      const option = h('div', { role: 'option', tabindex: '0', 'aria-selected': 'false', 'data-target': `frame:${frame.id}` }, `Frame: ${frame.title}`);
      listbox.appendChild(option);
    }
    dialog.appendChild(listbox);
    let chosen: string | null = null;
    listbox.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest('[role="option"]') as HTMLElement | null;
      if (!target) return;
      chosen = target.dataset.target ?? null;
      void applyMove();
    });
    listbox.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const target = (e.target as HTMLElement).closest('[role="option"]') as HTMLElement | null;
        if (target) { chosen = target.dataset.target ?? null; void applyMove(); }
      }
    });
    async function applyMove(): Promise<void> {
      if (!chosen || !board) return;
      const wid = (board.workshop as { id: string }).id;
      const [kind, id] = chosen.split(':');
      const placement: Record<string, unknown> = kind === 'cluster'
        ? { frameId: board.clusters.find((c) => c.id === id)?.frameId, clusterId: id }
        : { frameId: id, clusterId: null };
      const res = await api('PATCH', `/api/notes/${noteId}`, { clientOpId: newClientOpId(), placement }, { retry: true });
      dialog.close();
      if (res.status === 200) {
        const clusterTitle = kind === 'cluster' ? board.clusters.find((c) => c.id === id)?.title : board.frames.find((f) => f.id === id)?.title;
        announceActivity(regions, `Moved to ${clusterTitle}`);
        void loadBoard(wid, false);
      } else {
        announceProblem(regions, `Move not saved — ${res.networkError ? "you're offline" : errorMessage(res.body as never)}. The note is back where everyone else sees it.`);
      }
    }
  } });
}

async function spendDot(cluster: ShapedCluster, btn: HTMLButtonElement): Promise<void> {
  if (!board) return;
  const wid = (board.workshop as { id: string }).id;
  btn.disabled = true;
  const res = await api<{ dotsRemaining: number }>('POST', `/api/clusters/${cluster.id}/dots`, { clientOpId: newClientOpId() }, { retry: true });
  btn.disabled = false;
  if (res.status === 201) {
    announceActivity(regions, `Dot placed on ${cluster.title}. ${res.body.dotsRemaining} left.`);
    void loadBoard(wid, false);
  } else {
    announceProblem(regions, errorMessage(res.body as never));
    if (res.status === 401 && errorCode(res.body as never) === 'session_ended') renderRoom(appEl(), wid, { ended: true });
  }
}

async function returnDot(cluster: ShapedCluster, btn: HTMLButtonElement): Promise<void> {
  if (!board) return;
  const wid = (board.workshop as { id: string }).id;
  btn.disabled = true;
  const res = await api<{ dotsRemaining: number }>('POST', `/api/clusters/${cluster.id}/dots/return`, { clientOpId: newClientOpId() }, { retry: true });
  btn.disabled = false;
  if (res.status === 200) {
    announceActivity(regions, `Dot removed from ${cluster.title}. ${res.body.dotsRemaining} left.`);
    void loadBoard(wid, false);
  } else {
    announceProblem(regions, errorMessage(res.body as never));
  }
}

function renderRail(): void {
  const railFrames = document.getElementById('rail-frames');
  if (!railFrames || !board) return;
  railFrames.replaceChildren();
  for (const frame of board.frames) {
    const btn = h('button', { 'aria-label': frame.title }, frame.title) as HTMLButtonElement;
    btn.addEventListener('click', () => centreOnFrame(frame));
    railFrames.appendChild(btn);
  }
  if (board.viewer.role === 'facilitator') {
    const add = h('button', { 'aria-label': 'Add frame' }, 'Add frame') as HTMLButtonElement;
    add.addEventListener('click', () => openAddFrame());
    railFrames.appendChild(add);
  }
}

function openAddFrame(): void {
  if (!board) return;
  openDialog({ label: 'Add frame', onOpen: (dialog) => {
    dialog.innerHTML = `<h2>Add frame</h2>
      <label for="frame-title">Title</label>
      <input id="frame-title">
      <button id="frame-save">Save frame</button>`;
    dialog.querySelector('#frame-save')?.addEventListener('click', async () => {
      const title = (dialog.querySelector('#frame-title') as HTMLInputElement).value.trim();
      const wid = (board?.workshop as { id: string }).id;
      const res = await api('POST', `/api/workshops/${wid}/frames`, {
        clientOpId: newClientOpId(), title, x: 1800, y: 0, width: 800, height: 600,
      }, { retry: true });
      if (res.status === 201) {
        dialog.close();
        void loadBoard(wid, false);
      } else {
        announceProblem(regions, errorMessage(res.body as never));
      }
    });
  } });
}

function openFrameMenu(frame: ShapedFrame): void {
  const menu = h('div', { role: 'menu', 'aria-label': `Frame options ${frame.title}` });
  menu.style.position = 'fixed';
  menu.style.left = '50%';
  menu.style.top = '40%';
  menu.style.zIndex = '50';
  const rename = h('div', { role: 'menuitem', tabindex: '0' }, 'Rename');
  const trash = h('div', { role: 'menuitem', tabindex: '0' }, 'Move to trash');
  menu.replaceChildren(rename, trash);
  document.body.appendChild(menu);
  const close = (): void => menu.remove();
  rename.addEventListener('click', () => { close(); openRenameFrame(frame); });
  trash.addEventListener('click', () => { close(); void trashFrame(frame); });
  document.addEventListener('click', close, { once: true });
  menu.addEventListener('click', (e) => e.stopPropagation());
}

function openRenameFrame(frame: ShapedFrame): void {
  if (!board) return;
  openDialog({ label: 'Rename frame', onOpen: (dialog) => {
    dialog.innerHTML = `<h2>Rename frame</h2>
      <label for="rt">Title</label><input id="rt" value="${escapeHtml(frame.title)}">
      <button id="rt-save">Save</button>`;
    dialog.querySelector('#rt-save')?.addEventListener('click', async () => {
      const title = (dialog.querySelector('#rt') as HTMLInputElement).value.trim();
      const wid = (board?.workshop as { id: string }).id;
      const res = await api('PATCH', `/api/frames/${frame.id}`, { clientOpId: newClientOpId(), title }, { retry: true });
      dialog.close();
      if (res.status === 200) void loadBoard(wid, false);
      else announceProblem(regions, errorMessage(res.body as never));
    });
  } });
}

async function trashFrame(frame: ShapedFrame): Promise<void> {
  if (!board) return;
  const wid = (board.workshop as { id: string }).id;
  const res = await api('POST', `/api/frames/${frame.id}/trash`, { clientOpId: newClientOpId() }, { retry: true });
  if (res.status === 200) {
    announceActivity(regions, `Frame ${frame.title} moved to trash`);
    void loadBoard(wid, false);
  } else {
    announceProblem(regions, errorMessage(res.body as never));
  }
}

// ---- drawer

function renderDrawer(): void {
  const body = document.getElementById('drawer-body');
  if (!body || !board) return;
  body.replaceChildren();
  const workshop = board.workshop as {
    id: string; title: string; status: WorkshopStatus; round?: { number: number; endsAt: string } | null;
    voting?: { dotBudget: number; endsAt: string } | null; version: number;
    fee?: { amount: string }; recap?: { status: string; reason: string | null; attempts: number; recipients: number | null; recapUrl: string; invoice?: { number: string; amount: string } | null } | null;
    joinUrl?: string | null; joinLinkExpiresAt?: string | null; invites?: Array<{ email: string; status: string }>;
    participantCount?: number; participantCap?: number | null; roundsUsed?: number;
  };
  const isFacilitator = board.viewer.role === 'facilitator';
  // timer
  const timer = el(`<div class="rule"><h2>Timer</h2><timer id="session-timer" role="timer" aria-label="Session timer"><span class="timer-value" id="timer-value">--:--</span></timer></div>`);
  body.appendChild(timer);
  // dots budget (participants, during voting)
  if (board.viewer.role === 'participant' && workshop.status === 'voting') {
    const left = board.viewer.dotsRemaining ?? 0;
    body.appendChild(el(`<div class="rule">${left} of ${workshop.voting?.dotBudget ?? 0} dots left</div>`));
  }
  // facilitator controls
  if (isFacilitator) {
    const controls = el('<div class="rule" id="fac-controls"><h2>Facilitator</h2></div>');
    const transitions = legalNext(workshop.status);
    if (transitions.includes('open')) controls.appendChild(transitionBtn('Open room', 'open'));
    if (transitions.includes('silent_round')) {
      controls.appendChild(spinbox('Round length in minutes', 5));
      controls.appendChild(transitionBtn('Start silent round', 'silent_round'));
    }
    if (transitions.includes('revealed')) {
      controls.appendChild(transitionBtn('Reveal', 'revealed'));
    }
    if (transitions.includes('voting')) {
      controls.appendChild(spinbox('Voting length in minutes', 2));
      controls.appendChild(spinbox('Dots per person', 3));
      controls.appendChild(transitionBtn('Start voting', 'voting'));
    }
    if (transitions.includes('closed')) controls.appendChild(transitionBtn('Close workshop', 'closed'));
    if (transitions.includes('archived')) controls.appendChild(transitionBtn('Archive', 'archived'));
    body.appendChild(controls);
    // room list during a silent round
    if (workshop.status === 'silent_round' && board.participants) {
      const listWrap = el('<div class="rule"><h2>Room</h2><ul class="drawer-list" aria-label="Room"></ul></div>');
      const list = listWrap.querySelector('ul') as HTMLElement;
      for (const p of board.participants) {
        list.appendChild(h('li', {}, `${p.displayName} — ${p.notesThisRound} notes this round`));
      }
      body.appendChild(listWrap);
    }
    // vote totals during voting and after close
    if (workshop.status === 'voting' || workshop.status === 'closed' || workshop.status === 'archived') {
      const totalsWrap = el('<div class="rule"><h2>Vote totals</h2><ul class="drawer-list" aria-label="Vote totals"></ul></div>');
      const list = totalsWrap.querySelector('ul') as HTMLElement;
      const ranked = [...(board.clusters ?? [])].sort((a, b) => (b.dotTotal ?? 0) - (a.dotTotal ?? 0));
      for (const c of ranked) {
        list.appendChild(h('li', {}, `${c.title} — ${c.dotTotal ?? 0} dots`));
      }
      body.appendChild(totalsWrap);
    }
    // link + invites
    const linkWrap = el('<div class="rule"><h2>Join link</h2></div>');
    if (workshop.joinUrl) {
      linkWrap.appendChild(h('div', { class: 'mono small' }, workshop.joinUrl));
      linkWrap.appendChild(h('div', { class: 'muted' }, `Expires ${workshop.joinLinkExpiresAt ? new Date(workshop.joinLinkExpiresAt).toLocaleString() : ''}`));
    } else {
      linkWrap.appendChild(h('div', { class: 'muted' }, 'No active join link'));
    }
    const copy = h('button', { 'aria-label': 'Copy join link' }, 'Copy join link');
    const rotate = h('button', { 'aria-label': 'New join link' }, 'New join link');
    const off = h('button', { 'aria-label': 'Turn off join link', class: 'danger' }, 'Turn off join link');
    copy.addEventListener('click', async () => {
      if (workshop.joinUrl) await navigator.clipboard.writeText(workshop.joinUrl).catch(() => undefined);
      announceActivity(regions, 'Join link copied');
    });
    rotate.addEventListener('click', () => void linkAction('rotate'));
    off.addEventListener('click', () => void linkAction('off'));
    linkWrap.append(copy, rotate, off);
    body.appendChild(linkWrap);

    const inviteWrap = el(`<div class="rule"><h2>Invites</h2>
      <label for="invite-emails">Client emails</label>
      <textarea id="invite-emails" rows="3"></textarea>
      <button id="invite-send">Send invites</button>
      <ul class="drawer-list" aria-label="Invites" id="invite-list"></ul></div>`);
    inviteWrap.querySelector('#invite-send')?.addEventListener('click', () => void sendInvites());
    const inviteList = inviteWrap.querySelector('#invite-list') as HTMLElement;
    for (const inv of workshop.invites ?? []) {
      inviteList.appendChild(h('li', {}, `${inv.email} — ${inv.status}`));
    }
    body.appendChild(inviteWrap);
    // trash, versions, recap
    const misc = el('<div class="rule"><h2>Board</h2></div>');
    const trashBtn = h('button', { 'aria-label': 'Trash' }, 'Trash');
    const versionsBtn = h('button', { 'aria-label': 'Versions' }, 'Versions');
    trashBtn.addEventListener('click', () => openTrashDialog());
    versionsBtn.addEventListener('click', () => openVersionsDialog());
    misc.append(trashBtn, versionsBtn);
    body.appendChild(misc);
    if (workshop.recap) {
      const recapText = recapCopy(workshop.recap);
      body.appendChild(el(`<div class="rule"><h2>Recap</h2><div>${escapeHtml(recapText)}</div>${workshop.recap.invoice ? `<div class="mono">Invoice ${workshop.recap.invoice.number} — €${workshop.recap.invoice.amount}</div>` : ''}${workshop.recap.status === 'complete' ? `<a href="${workshop.recap.recapUrl}">Open recap page</a>` : ''}</div>`));
    }
  }
  startTimer();
}

function recapCopy(recap: { status: string; reason: string | null; attempts: number; recipients: number | null }): string {
  if (recap.status === 'complete') return `Recap sent to ${recap.recipients ?? 0} people`;
  if (recap.reason === 'storage_unavailable') return 'Recap queued — file storage is unavailable. It will finish automatically.';
  if (recap.reason === 'billing_unavailable') return 'Recap queued — billing is unavailable. Files are saved; the invoice and email will go out automatically.';
  if (recap.reason === 'mail_unavailable') return 'Recap queued — email is unavailable. Files are saved; the email will go out automatically.';
  return 'Recap in progress';
}

function legalNext(status: WorkshopStatus): WorkshopStatus[] {
  switch (status) {
    case 'draft': return ['open'];
    case 'open': return ['silent_round'];
    case 'silent_round': return ['revealed'];
    case 'revealed': return ['silent_round', 'voting'];
    case 'voting': return ['closed'];
    case 'closed': return ['archived'];
    default: return [];
  }
}

function spinbox(label: string, value: number): HTMLElement {
  const wrap = h('label', {}, label);
  const input = h('input', { type: 'number', min: '1', max: label.includes('Dots') ? '20' : '60', value: String(value), 'aria-label': label }) as HTMLInputElement;
  wrap.appendChild(input);
  return wrap;
}

function transitionBtn(label: string, to: string): HTMLButtonElement {
  const btn = h('button', { 'aria-label': label, 'data-to': to }, label) as HTMLButtonElement;
  btn.addEventListener('click', () => void doTransition(btn, to));
  return btn;
}

async function doTransition(btn: HTMLButtonElement, to: string): Promise<void> {
  if (!board) return;
  const wid = (board.workshop as { id: string }).id;
  const body: Record<string, unknown> = { clientOpId: newClientOpId(), to };
  const roundLen = document.querySelector('input[aria-label="Round length in minutes"]') as HTMLInputElement | null;
  const votingLen = document.querySelector('input[aria-label="Voting length in minutes"]') as HTMLInputElement | null;
  const dots = document.querySelector('input[aria-label="Dots per person"]') as HTMLInputElement | null;
  if (to === 'silent_round' && roundLen) body.durationSeconds = Math.round(Number(roundLen.value || 5) * 60);
  if (to === 'voting') {
    if (votingLen) body.durationSeconds = Math.round(Number(votingLen.value || 2) * 60);
    if (dots) body.dotBudget = Number(dots.value || 3);
  }
  const prevLabel = btn.textContent ?? '';
  btn.textContent = 'Working…';
  btn.disabled = true;
  const res = await api('POST', `/api/workshops/${wid}/transitions`, body, { retry: true });
  btn.disabled = false;
  btn.textContent = prevLabel;
  if (res.status === 200) {
    const ws = (res.body as { workshop: { status: WorkshopStatus; round?: { endsAt: string } | null; voting?: { dotBudget: number } | null } }).workshop;
    if (to === 'open') announceActivity(regions, 'Room open');
    if (to === 'silent_round') announceActivity(regions, `Silent round started — ends at ${ws.round ? hhmm(new Date(ws.round.endsAt), Intl.DateTimeFormat().resolvedOptions().timeZone) : ''}`);
    if (to === 'voting') announceActivity(regions, `Voting started — ${ws.voting?.dotBudget ?? 3} dots each`);
    if (to === 'closed') announceActivity(regions, 'Workshop closed. Preparing the recap.');
    if (to === 'archived') announceActivity(regions, 'Workshop archived');
    void loadBoard(wid, false);
  } else if (res.status === 402) {
    openUpgradeDialog(errorMessage(res.body as never));
  } else {
    announceProblem(regions, errorMessage(res.body as never));
    void loadBoard(wid, false);
  }
}

function openUpgradeDialog(limitMessage: string): void {
  const opener = document.activeElement as HTMLElement | null;
  openDialog({ label: 'Upgrade your plan', onOpen: (dialog) => {
    dialog.innerHTML = `<h2>Upgrade your plan</h2>
      <p>${escapeHtml(limitMessage)}</p>
      <p>Used of limit.</p>
      <a href="#/billing" id="see-plans">See plans</a>
      <button id="not-now">Not now</button>`;
    dialog.querySelector('#not-now')?.addEventListener('click', () => dialog.close());
    dialog.querySelector('#see-plans')?.addEventListener('click', () => { dialog.close(); window.location.hash = '#/billing'; });
    void opener;
  } });
}

async function linkAction(kind: 'rotate' | 'off'): Promise<void> {
  if (!board) return;
  const wid = (board.workshop as { id: string }).id;
  const res = kind === 'rotate'
    ? await api('POST', `/api/workshops/${wid}/join-link/rotate`)
    : await api('DELETE', `/api/workshops/${wid}/join-link`);
  if (res.status === 200) {
    announceActivity(regions, kind === 'rotate'
      ? 'New join link created. The old link no longer works.'
      : 'Join link turned off. Everyone who joined with it has been disconnected.');
    void loadBoard(wid, false);
  } else {
    announceProblem(regions, errorMessage(res.body as never));
  }
}

async function sendInvites(): Promise<void> {
  if (!board) return;
  const wid = (board.workshop as { id: string }).id;
  const area = document.getElementById('invite-emails') as HTMLTextAreaElement;
  const emails = area.value.split(/[\n,]/).map((s) => s.trim()).filter((s) => s.length > 0);
  const btn = document.getElementById('invite-send') as HTMLButtonElement;
  btn.textContent = 'Sending…';
  btn.disabled = true;
  const res = await api<{ invites: Array<{ email: string; status: string }> }>('POST', `/api/workshops/${wid}/invites`, { emails }, { retry: true });
  btn.disabled = false;
  btn.textContent = 'Send invites';
  if (res.status === 202) {
    const sent = res.body.invites.filter((i) => i.status === 'sent').length;
    const queued = res.body.invites.length - sent;
    announceActivity(regions, queued > 0
      ? `${sent} sent, ${queued} queued — email is unavailable. Queued invites go out automatically.`
      : `Invites sent to ${res.body.invites.length} people`);
    void loadBoard(wid, false);
  } else {
    announceProblem(regions, errorMessage(res.body as never));
  }
}

function startTimer(): void {
  const timerValue = document.getElementById('timer-value');
  if (!timerValue || !board) return;
  const workshop = board.workshop as { round?: { endsAt: string } | null; voting?: { endsAt: string } | null; status: WorkshopStatus };
  const endsAt = workshop.round?.endsAt ?? workshop.voting?.endsAt ?? null;
  window.clearInterval((window as unknown as { lfTimer?: number }).lfTimer);
  if (!endsAt) {
    timerValue.textContent = '--:--';
    return;
  }
  const tick = (): void => {
    const end = Date.parse(endsAt) - serverClockOffset;
    const left = Math.max(0, end - Date.now());
    const m = Math.floor(left / 60000);
    const s = Math.floor((left % 60000) / 1000);
    timerValue.textContent = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    timerValue.classList.toggle('low', left < 60000);
    if (left === 0) timerValue.textContent = "Time's up";
  };
  tick();
  (window as unknown as { lfTimer?: number }).lfTimer = window.setInterval(tick, 1000);
}

// ---- editor dialogs

function openNoteEditor(noteId?: string): void {
  if (!board) return;
  const note = noteId ? board.notes.find((n) => n.id === noteId) : null;
  openDialog({ label: note ? 'Edit note' : 'Add note', onOpen: (dialog) => {
    dialog.innerHTML = `<h2>${note ? 'Edit note' : 'Add note'}</h2>
      <label for="note-text">Note text</label>
      <textarea id="note-text">${note ? escapeHtml(note.text ?? '') : ''}</textarea>
      <label><input type="checkbox" id="note-fac" ${note?.facilitatorOnly ? 'checked' : ''}> Facilitator only</label>
      <div class="row"><button id="note-save">Save note</button><button id="note-cancel" class="ghost">Cancel</button></div>`;
    const textarea = dialog.querySelector('#note-text') as HTMLTextAreaElement;
    textarea.focus();
    textarea.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') save();
    });
    dialog.querySelector('#note-cancel')?.addEventListener('click', () => {
      dialog.close();
      if (noteId) (document.querySelector(`[data-note="${noteId}"]`) as HTMLElement | null)?.focus();
    });
    const saveBtn = dialog.querySelector('#note-save') as HTMLButtonElement;
    let pending = false;
    const save = async (): Promise<void> => {
      if (!board || pending) return;
      pending = true;
      saveBtn.textContent = 'Saving…';
      const wid = (board.workshop as { id: string }).id;
      const fac = (dialog.querySelector('#note-fac') as HTMLInputElement).checked;
      if (note) {
        const res = await api('PATCH', `/api/notes/${note.id}`, {
          clientOpId: newClientOpId(), text: textarea.value, ...(board.viewer.role === 'facilitator' ? { facilitatorOnly: fac } : {}),
        }, { retry: true });
        pending = false;
        saveBtn.textContent = 'Save note';
        if (res.status === 200) {
          dialog.close();
          void loadBoard(wid, false);
        } else {
          announceProblem(regions, `Edit not saved — ${res.networkError ? "you're offline" : errorMessage(res.body as never)}. The note shows its saved text.`);
          dialog.close();
          void loadBoard(wid, false);
        }
      } else {
        const frame = nearestFrameToCentre();
        if (!frame) return;
        const res = await api('POST', `/api/workshops/${wid}/notes`, {
          clientOpId: newClientOpId(), frameId: frame.id, kind: 'text',
          text: textarea.value, x: Math.round(frame.x + 80), y: Math.round(frame.y + 80),
          ...(board.viewer.role === 'facilitator' ? { facilitatorOnly: fac } : {}),
        }, { retry: true });
        pending = false;
        saveBtn.textContent = 'Save note';
        if (res.status === 201) {
          dialog.close();
          announceActivity(regions, `Note added to ${frame.title}`);
          void loadBoard(wid, false);
        } else {
          announceProblem(regions, `Note not added — ${res.networkError ? "you're offline" : errorMessage(res.body as never)}.`);
        }
      }
    };
    saveBtn.addEventListener('click', () => void save());
  } });
}

function nearestFrameToCentre(): ShapedFrame | null {
  if (!board || board.frames.length === 0) return null;
  const area = document.getElementById('board-area');
  if (!area) return board.frames[0];
  const rect = area.getBoundingClientRect();
  const cx = (rect.width / 2 - zoom.x) / zoom.k;
  const cy = (rect.height / 2 - zoom.y) / zoom.k;
  let best = board.frames[0];
  let bestDist = Infinity;
  for (const f of board.frames) {
    const dx = f.x + f.width / 2 - cx;
    const dy = f.y + f.height / 2 - cy;
    const d = dx * dx + dy * dy;
    if (d < bestDist) { bestDist = d; best = f; }
  }
  return best;
}

function openClusterEditor(): void {
  if (!board) return;
  openDialog({ label: 'Add cluster', onOpen: (dialog) => {
    dialog.innerHTML = `<h2>Add cluster</h2>
      <label for="cluster-title">Title</label><input id="cluster-title">
      <button id="cluster-save">Save</button>`;
    dialog.querySelector('#cluster-save')?.addEventListener('click', async () => {
      const frame = nearestFrameToCentre();
      if (!frame) return;
      const title = (dialog.querySelector('#cluster-title') as HTMLInputElement).value.trim();
      const wid = (board?.workshop as { id: string }).id;
      const res = await api('POST', `/api/workshops/${wid}/clusters`, {
        clientOpId: newClientOpId(), frameId: frame.id, title,
        x: Math.round(frame.x + 100), y: Math.round(frame.y + 120),
      }, { retry: true });
      dialog.close();
      if (res.status === 201) void loadBoard(wid, false);
      else announceProblem(regions, errorMessage(res.body as never));
    });
  } });
}

function pickImage(): void {
  if (!board) return;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/webp';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    const buf = await file.arrayBuffer();
    const wid = (board?.workshop as { id: string }).id;
    const toolbar = document.getElementById('toolbar') as HTMLElement;
    toolbar.setAttribute('aria-busy', 'true');
    const up = await fetch(`/api/workshops/${wid}/images`, {
      method: 'POST',
      headers: { 'Content-Type': file.type },
      body: buf,
    });
    toolbar.removeAttribute('aria-busy');
    if (!up.ok) {
      const body = await up.json().catch(() => ({ error: { message: 'Upload failed' } }));
      announceProblem(regions, (body as { error: { message: string } }).error?.message ?? 'Upload failed');
      return;
    }
    const image = await up.json() as { imageId: string };
    const frame = nearestFrameToCentre();
    if (!frame) return;
    const res = await api('POST', `/api/workshops/${wid}/notes`, {
      clientOpId: newClientOpId(), frameId: frame.id, kind: 'image', imageId: image.imageId,
      x: Math.round(frame.x + 80), y: Math.round(frame.y + 80),
    }, { retry: true });
    if (res.status === 201) {
      announceActivity(regions, `Note added to ${frame.title}`);
      void loadBoard(wid, false);
    } else {
      announceProblem(regions, `Note not added — ${res.networkError ? "you're offline" : errorMessage(res.body as never)}.`);
    }
  });
  input.click();
}

let connectMode = false;
function toggleConnectMode(): void {
  connectMode = !connectMode;
  (document.getElementById('toolbar') as HTMLElement).querySelectorAll('button').forEach((b) => b.classList.remove('active'));
  if (connectMode) {
    (document.getElementById('toolbar')?.children[3] as HTMLElement).classList.add('active');
    announceActivity(regions, 'Connect notes: choose two notes.');
  }
}

// ---- trash and versions dialogs

function openTrashDialog(): void {
  if (!board) return;
  const wid = (board.workshop as { id: string }).id;
  openDialog({ label: 'Trash', onOpen: async (dialog) => {
    dialog.innerHTML = '<h2>Trash</h2><div id="trash-body"></div>';
    const res = await api<{ items: Array<{ id: string; title: string; deletedAt: string; purgeAt: string; noteCount: number }> }>('GET', `/api/workshops/${wid}/trash`);
    const body = dialog.querySelector('#trash-body') as HTMLElement;
    if (res.status !== 200) { body.textContent = errorMessage(res.body as never); return; }
    for (const item of res.body.items) {
      const row = el('<div class="drawer-list"></div>');
      row.appendChild(h('span', {}, `Deleted ${new Date(item.deletedAt).toLocaleDateString()}, purged ${new Date(item.purgeAt).toLocaleDateString()}`));
      const restore = h('button', { 'aria-label': `Restore ${item.title}` }, `Restore ${item.title}`) as HTMLButtonElement;
      restore.addEventListener('click', async () => {
        const r = await api('POST', `/api/trash/${item.id}/restore`, { clientOpId: newClientOpId() }, { retry: true });
        if (r.status === 200) {
          const restored = (r.body as { restored: { notes: number } }).restored;
          announceActivity(regions, `Frame ${item.title} restored with ${restored.notes} notes`);
          dialog.close();
          void loadBoard(wid, false);
        } else {
          announceProblem(regions, errorMessage(r.body as never));
        }
      });
      row.appendChild(restore);
      body.appendChild(row);
    }
  } });
}

function openVersionsDialog(): void {
  if (!board) return;
  const wid = (board.workshop as { id: string }).id;
  openDialog({ label: 'Versions', onOpen: async (dialog) => {
    dialog.innerHTML = '<h2>Versions</h2><div id="versions-body"></div>';
    const res = await api<{ versions: Array<{ id: string; version: number; reason: string; createdAt: string }> }>('GET', `/api/workshops/${wid}/versions`);
    const body = dialog.querySelector('#versions-body') as HTMLElement;
    if (res.status !== 200) { body.textContent = errorMessage(res.body as never); return; }
    const reasonLabel = (r: string): string => r === 'auto' ? 'Autosave' : r === 'close' ? 'At close' : 'Before restore';
    for (const v of res.body.versions) {
      const row = el('<div class="drawer-list"></div>');
      const d = new Date(v.createdAt);
      row.appendChild(h('span', {}, `Version ${v.version} — ${reasonLabel(v.reason)} — ${d.toLocaleDateString()}, ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`));
      const restore = h('button', { 'aria-label': `Restore version ${v.version}` }, `Restore version ${v.version}`) as HTMLButtonElement;
      restore.addEventListener('click', () => openRestoreConfirm(v.id, v.version, wid));
      row.appendChild(restore);
      body.appendChild(row);
    }
  } });
}

function openRestoreConfirm(versionId: string, version: number, wid: string): void {
  openDialog({ label: `Restore version ${version}`, onOpen: (dialog) => {
    dialog.innerHTML = `<h2>Restore version ${version}?</h2><p>The current board is saved as a version first.</p>
      <button id="confirm-restore">Restore</button><button id="confirm-cancel" class="ghost">Cancel</button>`;
    dialog.querySelector('#confirm-cancel')?.addEventListener('click', () => dialog.close());
    dialog.querySelector('#confirm-restore')?.addEventListener('click', async () => {
      const btn = dialog.querySelector('#confirm-restore') as HTMLButtonElement;
      btn.textContent = 'Restoring…';
      const res = await api<{ saved: { version: number } }>('POST', `/api/workshops/${wid}/versions/${versionId}/restore`, { clientOpId: newClientOpId() }, { retry: true });
      dialog.close();
      if (res.status === 200) {
        announceActivity(regions, `Board restored to version ${version}. The previous board is saved as version ${res.body.saved.version}.`);
        void loadBoard(wid, false);
      } else {
        announceProblem(regions, errorMessage(res.body as never));
      }
    });
  } });
}

// ---- zoom and pan

function applyZoom(): void {
  const viewport = document.getElementById('viewport');
  if (!viewport) return;
  viewport.style.transform = `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.k})`;
  viewport.style.transformOrigin = '0 0';
}

function stepZoom(dir: number): void {
  zoom.k = Math.min(4, Math.max(0.25, zoom.k * (dir > 0 ? 1.2 : 1 / 1.2)));
  applyZoom();
}

function fitBoard(): void {
  if (!board || board.frames.length === 0) return;
  const area = document.getElementById('board-area');
  if (!area) return;
  const rect = area.getBoundingClientRect();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const f of board.frames) {
    minX = Math.min(minX, f.x);
    minY = Math.min(minY, f.y);
    maxX = Math.max(maxX, f.x + f.width);
    maxY = Math.max(maxY, f.y + f.height);
  }
  const k = Math.min(rect.width / (maxX - minX + 100), rect.height / (maxY - minY + 140), 1);
  zoom.k = Math.min(1.5, Math.max(0.25, k));
  zoom.x = (rect.width - (maxX - minX) * zoom.k) / 2 - minX * zoom.k;
  zoom.y = (rect.height - (maxY - minY) * zoom.k) / 2 - minY * zoom.k;
  applyZoom();
}

function centreOnFrame(frame: ShapedFrame): void {
  const area = document.getElementById('board-area');
  if (!area) return;
  const rect = area.getBoundingClientRect();
  const needed = Math.min(rect.width / (frame.width + 80), rect.height / (frame.height + 140), 1);
  if (needed < zoom.k) zoom.k = Math.max(0.25, needed);
  zoom.x = (rect.width - frame.width * zoom.k) / 2 - frame.x * zoom.k;
  zoom.y = (rect.height - frame.height * zoom.k) / 2 - frame.y * zoom.k;
  applyZoom();
  const heading = document.querySelector(`[data-frame="${frame.id}"] h2`) as HTMLElement | null;
  heading?.focus();
}

function centreOnNote(noteId: string): void {
  const node = document.querySelector(`[data-note="${noteId}"]`) as HTMLElement | null;
  if (!node || !board) return;
  const area = document.getElementById('board-area');
  if (!area) return;
  const rect = area.getBoundingClientRect();
  const nodeRect = node.getBoundingClientRect();
  const cx = (nodeRect.left + nodeRect.width / 2 - rect.left) / zoom.k;
  const cy = (nodeRect.top + nodeRect.height / 2 - rect.top) / zoom.k;
  zoom.x = rect.width / 2 - cx * zoom.k;
  zoom.y = rect.height / 2 - cy * zoom.k;
  applyZoom();
  (node as HTMLElement).focus();
}

// ---- the reveal wave (DP-16, DP-17, DP-67)

function maybeRevealWave(prev: BoardData | null, next: BoardData): void {
  if (!prev) return;
  const prevStatus = (prev.workshop as { status: WorkshopStatus }).status;
  const nextStatus = (next.workshop as { status: WorkshopStatus }).status;
  const prevRound = (prev.workshop as { round?: { number: number } | null }).round?.number ?? 0;
  const nextRound = (next.workshop as { round?: { number: number } | null }).round?.number ?? 0;
  const waveStates: WorkshopStatus[] = ['revealed', 'voting', 'closed', 'archived'];
  const runs = (prevStatus === 'silent_round' && waveStates.includes(nextStatus)) || nextRound > prevRound;
  if (!runs) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // the cards that were card backs in the last-rendered board flip now
  const backIds = new Set(prev.notes.filter((n) => n.text === null && !n.mine).map((n) => n.id));
  const announceFrames: Array<{ title: string; n: number }> = [];
  for (const frame of prev.frames) {
    const wasHidden = frame.hiddenCount > 0 || prev.notes.some((n) => n.frameId === frame.id && n.mine && n.text === null);
    if (!wasHidden) continue;
    const newFrame = next.frames.find((f) => f.id === frame.id);
    announceFrames.push({ title: frame.title, n: newFrame?.noteCount ?? 0 });
  }
  for (const frame of next.frames) {
    const frameEl = document.querySelector(`[data-frame="${frame.id}"]`) as HTMLElement | null;
    if (!frameEl) continue;
    const backs = Array.from(frameEl.querySelectorAll<HTMLElement>('.card-back'))
      .filter((b) => backIds.has(b.dataset.note ?? ''));
    if (backs.length === 0) continue;
    const cx = frame.x + frame.width / 2;
    const cy = frame.y + frame.height / 2;
    const ranks = new Map<number, number>();
    for (const b of backs) {
      const note = next.notes.find((n) => n.id === b.dataset.note);
      if (!note) continue;
      const d = Math.hypot(note.x + 76 - cx, note.y + 22 - cy);
      const rank = Math.round(d / 40);
      if (!ranks.has(rank)) ranks.set(rank, 0);
      ranks.set(rank, (ranks.get(rank) ?? 0) + 1);
    }
    const sortedRanks = [...ranks.keys()].sort((a, b) => a - b);
    const gap = sortedRanks.length > 21 ? 480 / sortedRanks.length : 24;
    sortedRanks.forEach((rank, i) => {
      for (const b of backs) {
        const note = next.notes.find((n) => n.id === b.dataset.note);
        if (!note) continue;
        const d = Math.hypot(note.x + 76 - cx, note.y + 22 - cy);
        if (Math.round(d / 40) !== rank) continue;
        const delay = i * gap;
        if (reduced) {
          b.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, delay, fill: 'backwards' });
        } else {
          b.animate(
            [{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(180deg)' }],
            { duration: 420, delay, easing: 'cubic-bezier(0.4,0,0.2,1)', fill: 'forwards' },
          );
        }
      }
    });
  }
  // announcements follow the wave rule
  const messages: string[] = [];
  if (lastStreamDown) messages.push('Back online');
  lastStreamDown = false;
  for (const f of announceFrames) {
    messages.push(`${f.n === 1 ? 'Round revealed: 1 note in' : `Round revealed: ${f.n} notes in`} ${f.title} frame`);
  }
  if (messages.length > 0) announceActivity(regions, messages.join('. ') + '.');
  const firstAnnounced = announceFrames[0];
  if (firstAnnounced) {
    const heading = document.querySelector(`[data-frame] h2`) as HTMLElement | null;
    heading?.focus();
  }
}

// presence sending: at most 15/s, only while the pointer moves over the canvas
let lastPresenceAt = 0;
export function wirePresenceSending(workshopId: string): void {
  const area = document.getElementById('board-area');
  if (!area) return;
  let lastX = -1;
  let lastY = -1;
  area.addEventListener('pointermove', (e) => {
    const now = Date.now();
    if (now - lastPresenceAt < 67) return;
    const rect = area.getBoundingClientRect();
    const x = Math.round((e.clientX - rect.left - zoom.x) / zoom.k);
    const y = Math.round((e.clientY - rect.top - zoom.y) / zoom.k);
    if (x === lastX && y === lastY) return;
    lastX = x; lastY = y;
    lastPresenceAt = now;
    void api('POST', `/api/workshops/${workshopId}/presence`, { x, y });
  });
}

