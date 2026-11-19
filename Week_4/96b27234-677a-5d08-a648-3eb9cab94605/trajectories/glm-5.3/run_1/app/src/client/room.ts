// The room page: mirror, keyboard, direction buttons, sheet, announcements,
// the Earshot Ripple, and the 3D paper-cut scene.
import { api, el, focusMainHeading, pageNotFound, prefersReducedMotion, type Ctx } from './main';
import type { Me } from './main';
import { setupScene } from './scenes/room-scene';

export interface PersonMirror {
  personId: string;
  displayName: string;
  x: number;
  y: number;
  facing: string;
  seated: boolean;
  avatar: 'shown' | 'hidden' | 'fallback';
  host: boolean;
}

export interface FeatureMirror {
  id: string;
  kind: 'exit' | 'seat';
  x: number;
  y: number;
  occupiedBy: string;
}

interface SessionDetail {
  id: string;
  roomId: string;
  roomName: string;
  roomVersion: number;
  hostId: string;
  hostName: string;
  visibility: string;
  capacity: number;
  count: number;
  status: string;
  layout?: LayoutJson;
  features?: FeatureMirror[];
  people?: PersonMirror[];
}

export interface LayoutJson {
  width: number;
  height: number;
  spawn: { x: number; y: number }[];
  walls: { x: number; y: number }[];
  seats: { id: string; x: number; y: number }[];
  exits: { id: string; x: number; y: number }[];
}

export interface RoomRefs {
  region: HTMLElement;
  announcements: HTMLElement;
  peopleList: HTMLElement;
  featuresList: HTMLElement;
  chatLog: HTMLElement;
  chatInput: HTMLInputElement;
  chatStatus: HTMLElement;
  safetyStatus: HTMLElement;
  sheet: HTMLDialogElement | null;
  openSheetButton: HTMLButtonElement | null;
  scene: { update: (people: PersonMirror[], layout: LayoutJson, meId: string) => void; ripple: (r: number, mode: 'growing' | 'outline' | 'none') => void; dispose: () => void } | null;
  session: SessionDetail;
  meId: string;
}

const announcements: { text: string; at: number }[] = [];

export function announce(refs: RoomRefs, text: string): void {
  const now = performance.now();
  if (announcements.length && announcements[announcements.length - 1].text === text && now - announcements[announcements.length - 1].at < 2000) {
    return;
  }
  announcements.push({ text, at: now });
  if (announcements.length > 20) announcements.shift();
  renderAnnouncements(refs);
}

function renderAnnouncements(refs: RoomRefs): void {
  refs.announcements.textContent = '';
  for (const a of announcements) refs.announcements.append(el('p', {}, a.text));
}

export function closeSheet(): void {
  void 0;
}

function withinDistance(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= 6;
}

export async function renderRoomPage(ctx: Ctx, sessionId: string): Promise<void> {
  const m = ctx.me as Me;
  let detail: SessionDetail;
  try {
    detail = await api<SessionDetail>(`/api/sessions/${sessionId}`);
  } catch (e) {
    const status = (e as { status?: number }).status ?? 404;
    if (status === 404) {
      renderUnavailable(ctx, sessionId);
      return;
    }
    pageNotFound();
    return;
  }
  const inside = !!detail.people;
  if (!inside) {
    renderJoinable(ctx, detail);
    return;
  }
  buildRoom(ctx, detail, m);
}

function renderUnavailable(ctx: Ctx, sessionId: string): void {
  ctx.main.append(el('h1', {}, "This session isn't available."));
  void sessionId;
}

async function renderJoinable(ctx: Ctx, detail: SessionDetail): Promise<void> {
  ctx.main.append(el('h1', {}, detail.roomName));
  const p = el('p', {}, `Host: ${detail.hostName}. People: ${detail.count} of ${detail.capacity}.`);
  ctx.main.append(p);
  const result = el('div', { role: 'status', 'aria-label': 'Session result', class: 'status-region' });
  const alert = el('div', { role: 'alert', class: 'status-region' });
  const join = el('button', { class: 'primary' }, 'Join session');
  join.addEventListener('click', async () => {
    result.textContent = 'Opening...';
    try {
      await api(`/api/sessions/${detail.id}/join`, { method: 'POST' });
      location.href = `/sessions/${detail.id}`;
    } catch (e) {
      const err = e as { message?: string };
      if ((e as { status?: number }).status === 404) {
        renderUnavailable(ctx, detail.id);
        return;
      }
      result.textContent = err.message ?? "This session isn't available.";
      alert.textContent = err.message ?? '';
    }
  });
  ctx.main.append(el('div', { class: 'panel' }, join, result, alert));
}

function buildRoom(ctx: Ctx, detail: SessionDetail, m: Me): void {
  const main = ctx.main;
  main.textContent = '';
  main.append(el('h1', {}, detail.roomName));

  const region = el('section', {
    role: 'region',
    'aria-label': 'Room',
    'data-room-version': String(detail.roomVersion),
    'data-motion': prefersReducedMotion() ? 'reduced' : 'animated',
    'data-ripple': 'none',
    'data-ripple-radius': '0',
  });
  main.append(region);
  region.append(el('p', {}, `Room version ${detail.roomVersion}`));

  const layout = el('div', { class: 'room-layout desktop' });
  region.append(layout);

  // Canvas
  const canvasHolder = el('div', { class: 'room-centre' });
  const canvas = document.createElement('canvas');
  canvas.className = 'room-canvas';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Room view');
  canvasHolder.append(canvas);
  const directionRow = el('div', { class: 'direction-row' });
  const stepButtons: { dir: string; label: string }[] = [
    { dir: 'north', label: 'Step north' },
    { dir: 'east', label: 'Step east' },
    { dir: 'south', label: 'Step south' },
    { dir: 'west', label: 'Step west' },
  ];
  canvasHolder.append(directionRow);
  layout.append(canvasHolder);

  // People list (left) and features
  const left = el('div', { class: 'room-left' });
  const peopleList = el('ul', { class: 'plain', role: 'list', 'aria-label': 'People here' });
  const featuresList = el('ul', { class: 'plain', role: 'list', 'aria-label': 'Room features' });
  left.append(el('h2', {}, 'People here'), peopleList, el('h2', {}, 'Room features'), featuresList);
  layout.append(left);

  // Chat (right)
  const right = el('div', { class: 'room-right' });
  const chatLog = el('div', { role: 'log', 'aria-label': 'Nearby chat', class: 'panel' });
  const chatInput = el('input', { type: 'text', 'aria-label': 'Say something nearby' }) as HTMLInputElement;
  const send = el('button', {}, 'Send');
  const chatStatus = el('div', { role: 'status', 'aria-label': 'Chat result', class: 'status-region' });
  right.append(el('h2', {}, 'Nearby chat'), chatLog, chatInput, send, chatStatus);
  layout.append(right);

  // Announcements and safety live outside the sheet.
  const announcements = el('div', { role: 'status', 'aria-label': 'Room announcements', class: 'status-region panel' });
  region.insertBefore(announcements, layout);
  const safetyStatus = el('div', { role: 'status', 'aria-label': 'Safety result', class: 'status-region' });
  region.append(safetyStatus);
  const alert = el('div', { role: 'alert', class: 'status-region' });
  region.append(alert);

  // Phone sheet
  const openSheetButton = el('button', { class: 'people-chat-toggle primary' }, 'People and chat') as HTMLButtonElement;
  canvasHolder.append(openSheetButton);
  const sheet = el('dialog', { 'aria-label': 'People and chat' }) as HTMLDialogElement;
  sheet.className = 'sheet-holder';
  const sheetPeople = el('ul', { class: 'plain', role: 'list', 'aria-label': 'People here' });
  const sheetFeatures = el('ul', { class: 'plain', role: 'list', 'aria-label': 'Room features' });
  const sheetChatLog = el('div', { role: 'log', 'aria-label': 'Nearby chat', class: 'panel' });
  const sheetChatInput = el('input', { type: 'text', 'aria-label': 'Say something nearby' }) as HTMLInputElement;
  const sheetSend = el('button', {}, 'Send');
  const close = el('button', {}, 'Close');
  sheet.append(
    el('h2', {}, 'People here'), sheetPeople,
    el('h2', {}, 'Room features'), sheetFeatures,
    el('h2', {}, 'Nearby chat'), sheetChatLog, sheetChatInput, sheetSend, close
  );
  region.append(sheet);

  const hideSelect = el('select', { 'aria-label': 'Hide avatars above' }) as HTMLSelectElement;
  const hideOptions: [string, string][] = [['', 'Show all'], ['Feather', 'Feather'], ['Linen', 'Linen'], ['Cedar', 'Cedar'], ['Granite', 'Granite']];
  for (const [value, label] of hideOptions) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    if ((m.hideAbove ?? '') === value) o.selected = true;
    hideSelect.append(o);
  }
  canvasHolder.append(hideSelect);

  const leave = el('button', { class: 'danger' }, 'Leave session');
  canvasHolder.append(leave);

  const refs: RoomRefs = {
    region,
    announcements,
    peopleList,
    featuresList,
    chatLog,
    chatInput,
    chatStatus,
    safetyStatus,
    sheet,
    openSheetButton,
    scene: null,
    session: detail,
    meId: m.personId,
  };

  // Scene
  const scene = setupScene(canvas, prefersReducedMotion());
  refs.scene = scene;

  // Buttons
  for (const { dir, label } of stepButtons) {
    const b = el('button', { 'aria-label': label }, label.replace('Step ', ''));
    attachHold(b as HTMLButtonElement, () => void doStep(refs, dir));
    directionRow.append(b);
  }
  const sitStand = el('button', {}, 'Sit or stand') as HTMLButtonElement;
  sitStand.addEventListener('click', () => void doSitStand(refs));
  directionRow.append(sitStand);

  leave.addEventListener('click', async () => {
    await api(`/api/sessions/${detail.id}/leave`, { method: 'POST' }).catch(() => {});
    location.href = '/sessions';
  });

  hideSelect.addEventListener('change', async () => {
    const value = hideSelect.value === '' ? null : hideSelect.value;
    try {
      await api('/api/me/hide-above', { method: 'PUT', body: JSON.stringify({ rank: value }) });
      safetyStatus.textContent = value ? `Avatars above ${value} are hidden.` : 'All avatars are shown.';
      await refreshMirror(refs);
    } catch (e) {
      safetyStatus.textContent = (e as Error).message;
    }
  });

  // Chat
  const doSend = async (): Promise<void> => {
    const text = chatInput.value;
    if (!text.trim()) return;
    chatStatus.textContent = 'Sending...';
    try {
      const res = await api<{ heardBy: number }>(`/api/sessions/${detail.id}/chat`, {
        method: 'POST',
        body: JSON.stringify({ text }),
      });
      chatInput.value = '';
      chatStatus.textContent = `Heard by ${res.heardBy}.`;
      startRipple(refs);
    } catch (e) {
      chatStatus.textContent = (e as Error).message;
    }
  };
  send.addEventListener('click', () => void doSend());
  chatInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      void doSend();
    }
  });
  sheetSend.addEventListener('click', () => { chatInput.value = (sheetChatInput as HTMLInputElement).value; void doSend(); });

  // Sheet behaviour: a closed sheet is hidden and inert; reopening during the
  // exit keeps it open with no stale timer re-hiding it.
  let sheetClosing = false;
  let sheetCloseTimer: number | null = null;
  let sheetTrap: ((ev: KeyboardEvent) => void) | null = null;
  const openSheet = (): void => {
    if (sheetClosing) {
      sheetClosing = false;
      if (sheetCloseTimer !== null) { clearTimeout(sheetCloseTimer); sheetCloseTimer = null; }
      sheet.classList.remove('sheet-exit');
      return;
    }
    sheet.showModal();
    sheetTrap = trapFocus(sheet);
    const first = sheet.querySelector('button, input, select, a');
    (first as HTMLElement | null)?.focus();
  };
  const closeSheetNow = (opener: HTMLElement | null): void => {
    sheetClosing = true;
    const reduced = prefersReducedMotion();
    const finish = (): void => {
      sheetClosing = false;
      sheet.classList.remove('sheet-exit');
      if (sheetTrap) {
        sheet.removeEventListener('keydown', sheetTrap);
        sheetTrap = null;
      }
      sheet.close();
      (opener ?? openSheetButton)?.focus();
    };
    if (reduced) {
      finish();
      return;
    }
    sheet.classList.add('sheet-exit');
    sheetCloseTimer = window.setTimeout(finish, 250);
  };
  openSheetButton.addEventListener('click', openSheet);
  close.addEventListener('click', () => closeSheetNow(openSheetButton));
  sheet.addEventListener('cancel', (ev) => {
    ev.preventDefault();
    closeSheetNow(openSheetButton);
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (ev) => {
    const target = ev.target as HTMLElement;
    const inField = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
    const dialogOpen = !!(document.querySelector('dialog[open]') && target.closest('dialog') === null);
    if (inField || dialogOpen) return;
    const key = ev.key.toLowerCase();
    const arrows: Record<string, string> = { arrowup: 'north', arrowright: 'east', arrowdown: 'south', arrowleft: 'west' };
    if (arrows[key]) {
      ev.preventDefault();
      void doStep(refs, arrows[key]);
      return;
    }
    if (key === 's') { ev.preventDefault(); void doSitStand(refs); }
    if (key === 't') {
      ev.preventDefault();
      if (window.innerWidth <= 500 && !sheet.open) openSheet();
      chatInput.focus();
    }
    if (key === 'n') { ev.preventDefault(); announceNearby(refs); }
    if (key === 'm') { ev.preventDefault(); openNearestActions(refs); }
  });

  // WebSocket mirror
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/sessions/${detail.id}`);
  ws.addEventListener('message', (ev) => {
    void handleSocketFrame(refs, JSON.parse(ev.data as string));
  });
  let outage = false;
  const reconnect = (): void => {
    if (outage) {
      alert.textContent = 'Live rooms are unavailable right now.';
    }
    const retry = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/sessions/${detail.id}`);
    retry.addEventListener('open', async () => {
      outage = false;
      alert.textContent = '';
      announce(refs, 'Live room restored.');
      await refreshMirror(refs);
    });
    retry.addEventListener('message', (ev2) => {
      void handleSocketFrame(refs, JSON.parse(ev2.data as string));
    });
    retry.addEventListener('close', () => {
      outage = true;
      window.setTimeout(reconnect, 2000);
    });
  };
  ws.addEventListener('close', () => {
    outage = true;
    alert.textContent = 'Live rooms are unavailable right now.';
    window.setTimeout(reconnect, 2000);
  });
  void ws;

  // Me socket for pushed role changes and warnings
  const meWs = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/me`);
  meWs.addEventListener('message', (ev) => {
    const frame = JSON.parse(ev.data as string) as { type: string; text?: string };
    if (frame.type === 'warned') {
      alert.textContent = 'A moderator has warned you.';
    }
    if (frame.type === 'suspended') {
      alert.textContent = 'A moderator has removed you from this session.';
      window.setTimeout(() => { location.href = '/sessions'; }, 100);
    }
    if (frame.type === 'removed-from-community') {
      alert.textContent = 'You are no longer in this community.';
    }
  });

  void (async () => {
    await refreshMirror(refs);
    if (refs.session.people) {
      const me = refs.session.people.find((p) => p.personId === refs.meId);
      if (me) {
        for (const p of refs.session.people) {
          if (p.personId !== me.personId && withinDistance(me, p)) withinDistanceSet.add(p.personId);
        }
      }
    }
  })();
  void refreshChat(refs, chatLog);
  void loadNearbyChatInto(refs);
  arrangeViewport(region, layout);
  window.addEventListener('resize', () => arrangeViewport(region, layout));
}

function arrangeViewport(region: HTMLElement, layout: HTMLElement): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  let cls = 'room-layout desktop';
  if (w <= 500) cls = 'room-layout phone';
  else if (w <= 900) cls = 'room-layout tablet';
  else if (w <= 1280) cls = 'room-layout desktop';
  layout.className = cls;
  void region;
  void h;
}

async function refreshMirror(refs: RoomRefs): Promise<void> {
  const detail = await api<SessionDetail>(`/api/sessions/${refs.session.id}`);
  refs.session = detail;
  if (!detail.people || !detail.features || !detail.layout) return;
  renderPeople(refs, detail.people, detail.features, detail.layout);
  refs.region.setAttribute('data-room-version', String(detail.roomVersion));
  const versionText = refs.region.querySelector('p');
  if (versionText) versionText.textContent = `Room version ${detail.roomVersion}`;
  refs.scene?.update(detail.people, detail.layout as LayoutJson, refs.meId);
}

function renderPeople(refs: RoomRefs, people: PersonMirror[], features: FeatureMirror[], layout: LayoutJson): void {
  const buildList = (list: HTMLElement): void => {
    list.textContent = '';
    for (const p of people) {
      const item = el('li', {
        'data-person-id': p.personId,
        'data-display-name': p.displayName,
        'data-tile-x': String(p.x),
        'data-tile-y': String(p.y),
        'data-facing': p.facing,
        'data-seated': String(p.seated),
        'data-avatar': p.avatar,
        'data-host': String(p.host),
      });
      const actions = el('button', { 'aria-label': `Actions for ${p.displayName}` }, `Actions for ${p.displayName}`);
      actions.addEventListener('click', () => openPersonActions(refs, p));
      item.append(document.createTextNode(`${p.displayName} (${p.x},${p.y}) `), actions);
      list.append(item);
    }
  };
  buildList(refs.peopleList);
  const sheetList = refs.sheet?.querySelector('[aria-label="People here"]') as HTMLElement | null;
  if (sheetList) buildList(sheetList);
  attachActionsInList(sheetList, refs);

  refs.featuresList.textContent = '';
  for (const f of features) {
    refs.featuresList.append(el('li', {
      'data-feature-id': f.id,
      'data-kind': f.kind,
      'data-tile-x': String(f.x),
      'data-tile-y': String(f.y),
      'data-occupied-by': f.occupiedBy,
    }, `${f.kind} at (${f.x},${f.y})`));
  }
  const sheetFeatures = refs.sheet?.querySelector('[aria-label="Room features"]') as HTMLElement | null;
  if (sheetFeatures) {
    sheetFeatures.textContent = '';
    for (const f of features) {
      sheetFeatures.append(el('li', {
        'data-feature-id': f.id,
        'data-kind': f.kind,
        'data-tile-x': String(f.x),
        'data-tile-y': String(f.y),
        'data-occupied-by': f.occupiedBy,
      }, `${f.kind} at (${f.x},${f.y})`));
    }
  }
  void layout;
}

function attachActionsInList(list: HTMLElement | null, refs: RoomRefs): void {
  list?.querySelectorAll('button').forEach((b) => {
    const label = b.getAttribute('aria-label') ?? '';
    const name = label.replace('Actions for ', '');
    b.addEventListener('click', () => {
      const person = refs.session.people?.find((p) => p.displayName === name);
      if (person) openPersonActions(refs, person);
    });
  });
}

async function doStep(refs: RoomRefs, direction: string): Promise<void> {
  try {
    const res = await api<{ result: string; x: number; y: number; facing: string }>(`/api/sessions/${refs.session.id}/step`, {
      method: 'POST',
      body: JSON.stringify({ direction }),
    });
    if (res.result === 'left') {
      location.href = '/sessions';
      return;
    }
    await refreshMirror(refs);
  } catch (e) {
    announce(refs, (e as Error).message);
  }
}

async function doSitStand(refs: RoomRefs): Promise<void> {
  try {
    const me = refs.session.people?.find((p) => p.personId === refs.meId);
    if (me?.seated) {
      await api(`/api/sessions/${refs.session.id}/stand`, { method: 'POST' });
    } else {
      await api(`/api/sessions/${refs.session.id}/sit`, { method: 'POST' });
    }
    await refreshMirror(refs);
  } catch (e) {
    announce(refs, (e as Error).message);
  }
}

function announceNearby(refs: RoomRefs): void {
  const me = refs.session.people?.find((p) => p.personId === refs.meId);
  if (!me) return;
  const nearby = (refs.session.people ?? [])
    .filter((p) => p.personId !== me.personId && withinDistance(me, p))
    .sort((a, b) => {
      const da = Math.max(Math.abs(a.x - me.x), Math.abs(a.y - me.y));
      const db = Math.max(Math.abs(b.x - me.x), Math.abs(b.y - me.y));
      if (da !== db) return da - db;
      if (a.displayName !== b.displayName) return a.displayName < b.displayName ? -1 : 1;
      return a.personId < b.personId ? -1 : 1;
    });
  if (!nearby.length) {
    announce(refs, 'Nobody is nearby.');
    return;
  }
  announce(refs, `Nearby: ${nearby.map((p) => p.displayName).join(', ')}.`);
}

function nearestPerson(refs: RoomRefs): PersonMirror | null {
  const me = refs.session.people?.find((p) => p.personId === refs.meId);
  const others = (refs.session.people ?? []).filter((p) => p.personId !== refs.meId);
  if (!me || !others.length) return null;
  const sorted = others.sort((a, b) => {
    const da = Math.max(Math.abs(a.x - me.x), Math.abs(a.y - me.y));
    const db = Math.max(Math.abs(b.x - me.x), Math.abs(b.y - me.y));
    if (da !== db) return da - db;
    if (a.displayName !== b.displayName) return a.displayName < b.displayName ? -1 : 1;
    return a.personId < b.personId ? -1 : 1;
  });
  return sorted[0];
}

function openNearestActions(refs: RoomRefs): void {
  const target = nearestPerson(refs);
  if (!target) {
    announce(refs, 'Nobody is nearby.');
    return;
  }
  openPersonActions(refs, target);
}

// Tab and Shift+Tab wrap inside an open dialog or sheet, so focus never
// leaves it.
export function trapFocus(container: HTMLElement): (ev: KeyboardEvent) => void {
  const handler = (ev: KeyboardEvent): void => {
    if (ev.key !== 'Tab') return;
    const focusables = [...container.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href]')]
      .filter((n) => !n.hasAttribute('disabled') && n.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (ev.shiftKey) {
      if (active === first || !container.contains(active)) {
        ev.preventDefault();
        last.focus();
      }
    } else if (active === last || !container.contains(active)) {
      ev.preventDefault();
      first.focus();
    }
  };
  container.addEventListener('keydown', handler);
  return handler;
}

function openPersonActions(refs: RoomRefs, person: PersonMirror): void {
  const dialog = el('dialog', { 'aria-label': 'Person actions' }) as HTMLDialogElement;
  const untrap = trapFocus(dialog);
  dialog.append(el('h2', {}, `Actions for ${person.displayName}`));
  const block = el('button', {}, 'Block');
  const mute = el('button', {}, 'Mute');
  const vote = el('button', {}, 'Start removal vote');
  const report = el('button', {}, 'Report');
  const close = el('button', {}, 'Close');
  const status = el('div', { role: 'status', 'aria-label': 'Safety result', class: 'status-region' });
  dialog.append(block, mute, vote, report, close, status);
  document.body.append(dialog);
  dialog.showModal();

  block.addEventListener('click', async () => {
    status.textContent = 'Saving...';
    try {
      const blocked = block.textContent === 'Block';
      if (blocked) await api(`/api/blocks/${person.personId}`, { method: 'POST' });
      else await api(`/api/blocks/${person.personId}`, { method: 'DELETE' });
      status.textContent = blocked ? 'Blocked.' : 'Unblocked.';
      block.textContent = blocked ? 'Unblock' : 'Block';
      await refreshMirror(refs);
    } catch (e) { status.textContent = (e as Error).message; }
  });
  mute.addEventListener('click', async () => {
    status.textContent = 'Saving...';
    try {
      const muted = mute.textContent === 'Mute';
      if (muted) await api(`/api/mutes/${person.personId}`, { method: 'POST' });
      else await api(`/api/mutes/${person.personId}`, { method: 'DELETE' });
      status.textContent = muted ? 'Muted.' : 'Unmuted.';
      mute.textContent = muted ? 'Unmute' : 'Mute';
    } catch (e) { status.textContent = (e as Error).message; }
  });
  vote.addEventListener('click', async () => {
    status.textContent = 'Saving...';
    try {
      const res = await api<{ id: string }>(`/api/sessions/${refs.session.id}/votes`, {
        method: 'POST',
        body: JSON.stringify({ personId: person.personId }),
      });
      status.textContent = 'Vote counted.';
      renderVoteRegion(refs, person, res.id);
    } catch (e) { status.textContent = (e as Error).message; }
  });
  report.addEventListener('click', () => openReportDialog(refs, person));
  close.addEventListener('click', () => {
    dialog.removeEventListener('keydown', untrap);
    dialog.close();
    dialog.remove();
    focusMainHeading();
  });
}

function openReportDialog(refs: RoomRefs, person: PersonMirror): void {
  const dialog = el('dialog', { 'aria-label': 'Report someone' }) as HTMLDialogElement;
  const untrap = trapFocus(dialog);
  const category = el('select', { 'aria-label': 'Category' }) as HTMLSelectElement;
  for (const c of ['harassment', 'hateful-content', 'impersonation', 'other']) {
    const o = document.createElement('option');
    o.value = c;
    o.textContent = c;
    category.append(o);
  }
  const details = el('textarea', { 'aria-label': 'Details' });
  const send = el('button', { class: 'primary' }, 'Send report');
  const cancel = el('button', {}, 'Cancel');
  const status = el('div', { role: 'status', 'aria-label': 'Report result', class: 'status-region' });
  dialog.append(el('h2', {}, 'Report someone'), category, details, send, cancel, status);
  document.body.append(dialog);
  dialog.showModal();
  send.addEventListener('click', async () => {
    status.textContent = 'Sending...';
    try {
      await api('/api/reports', {
        method: 'POST',
        body: JSON.stringify({ personId: person.personId, sessionId: refs.session.id, category: category.value, details: (details as HTMLTextAreaElement).value }),
      });
      status.textContent = 'Report sent.';
    } catch (e) { status.textContent = (e as Error).message; }
  });
  cancel.addEventListener('click', () => {
    dialog.removeEventListener('keydown', untrap);
    dialog.close();
    dialog.remove();
  });
}

function renderVoteRegion(refs: RoomRefs, person: PersonMirror, voteId: string): void {
  const region = el('section', { role: 'region', 'aria-label': 'Removal vote', 'data-vote-status': 'open' });
  region.append(el('p', {}, `Vote on removing ${person.displayName}.`));
  const status = el('div', { role: 'status', 'aria-label': 'Vote result', class: 'status-region' });
  const yes = el('button', { class: 'danger' }, 'Vote yes');
  const no = el('button', {}, 'Vote no');
  yes.addEventListener('click', async () => {
    status.textContent = 'Saving...';
    try {
      const v = await api<{ status: string }>(`/api/sessions/${refs.session.id}/votes/${voteId}/ballots`, {
        method: 'POST',
        body: JSON.stringify({ choice: 'yes' }),
      });
      status.textContent = 'Vote counted.';
      if (v.status === 'passed') region.setAttribute('data-vote-status', 'passed');
    } catch (e) { status.textContent = (e as Error).message; }
  });
  no.addEventListener('click', async () => {
    status.textContent = 'Saving...';
    try {
      const v = await api<{ status: string }>(`/api/sessions/${refs.session.id}/votes/${voteId}/ballots`, {
        method: 'POST',
        body: JSON.stringify({ choice: 'no' }),
      });
      status.textContent = 'Vote counted.';
      if (v.status === 'failed') region.setAttribute('data-vote-status', 'failed');
    } catch (e) { status.textContent = (e as Error).message; }
  });
  region.append(yes, no, status);
  refs.region.append(region);
}

const withinDistanceSet = new Set<string>();

// Announces a person coming within chat distance of you after being out of it,
// including right after their arrival.
function announceNearbyChange(refs: RoomRefs, people: PersonMirror[]): void {
  const me = people.find((p) => p.personId === refs.meId);
  if (!me) return;
  const nowNear = new Set<string>();
  for (const p of people) {
    if (p.personId === me.personId) continue;
    if (withinDistance(me, p)) nowNear.add(p.personId);
  }
  for (const pid of nowNear) {
    if (!withinDistanceSet.has(pid)) {
      const person = people.find((p) => p.personId === pid);
      if (person) announce(refs, `${person.displayName} is nearby.`);
    }
  }
  withinDistanceSet.clear();
  nowNear.forEach((pid) => withinDistanceSet.add(pid));
}

async function handleSocketFrame(refs: RoomRefs, frame: Record<string, unknown>): Promise<void> {
  const type = frame.type as string;
  if (type === 'mirror' || type === 'moved' || type === 'arrived' || type === 'left' || type === 'removed-by-vote' || type === 'moderator-removed' || type === 'host-changed' || type === 'chat' || type === 'vote-opened' || type === 'vote-failed') {
    if (type === 'chat') {
      const fromName = frame.fromName as string;
      const text = frame.text as string;
      appendChat(refs, `${fromName}: ${text}`);
      return;
    }
    if (type === 'arrived') announce(refs, `${frame.name} arrived.`);
    if (type === 'left') announce(refs, `${frame.name} left.`);
    if (type === 'host-changed') announce(refs, `${frame.name} is now the host.`);
    if (type === 'removed-by-vote') announce(refs, `${frame.name} was removed by a vote.`);
    if (type === 'vote-failed') announce(refs, 'The vote did not pass.');
    if (type === 'moderator-removed') announce(refs, `${frame.name} left.`);
    if (frame.personId === refs.meId && type === 'removed-by-vote') {
      const alert = document.querySelector('[role="alert"]') as HTMLElement | null;
      if (alert) alert.textContent = 'The room voted to remove you.';
    }
    await refreshMirror(refs);
    if (refs.session.people) announceNearbyChange(refs, refs.session.people);
  }
}

function appendChat(refs: RoomRefs, line: string): void {
  const log = refs.chatLog;
  const entry = el('div', {}, line);
  log.append(entry);
  const sheetLog = refs.sheet?.querySelector('[role="log"]') as HTMLElement | null;
  sheetLog?.append(el('div', {}, line));
}

async function refreshChat(refs: RoomRefs, log: HTMLElement): Promise<void> {
  void refs;
  void log;
}

async function loadNearbyChatInto(refs: RoomRefs): Promise<void> {
  try {
    const res = await api<{ messages: { fromName: string; text: string }[] }>(`/api/sessions/${refs.session.id}/chat`);
    for (const m of res.messages) appendChat(refs, `${m.fromName}: ${m.text}`);
  } catch {
    // chat history only for members
  }
}

// Earshot Ripple: page-timer driven, never needing a rendered frame.
let rippleTimer: number | null = null;

export function startRipple(refs: RoomRefs): void {
  if (rippleTimer !== null) { clearTimeout(rippleTimer); rippleTimer = null; }
  const region = refs.region;
  if (prefersReducedMotion()) {
    region.setAttribute('data-ripple', 'outline');
    region.setAttribute('data-ripple-radius', '6');
    refs.scene?.ripple(6, 'outline');
    rippleTimer = window.setTimeout(() => {
      region.setAttribute('data-ripple', 'none');
      region.setAttribute('data-ripple-radius', '0');
      refs.scene?.ripple(0, 'none');
    }, 2000);
    return;
  }
  region.setAttribute('data-ripple', 'growing');
  let radius = 0;
  const tick = (): void => {
    region.setAttribute('data-ripple-radius', String(radius));
    refs.scene?.ripple(radius, 'growing');
    if (radius < 6) {
      radius += 1;
      rippleTimer = window.setTimeout(tick, 60);
    } else {
      rippleTimer = window.setTimeout(() => {
        region.setAttribute('data-ripple', 'none');
        region.setAttribute('data-ripple-radius', '0');
        refs.scene?.ripple(0, 'none');
      }, 500);
    }
  };
  tick();
}

// Hold repeat: one press steps once at once; holding repeats one press every
// 250 ms of page clock until release, including release outside the button.
function attachHold(button: HTMLButtonElement, action: () => void): void {
  let timer: number | null = null;
  const stop = (): void => {
    if (timer !== null) { clearTimeout(timer); timer = null; }
  };
  button.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    action();
    timer = window.setInterval(action, 250);
  });
  button.addEventListener('pointerup', stop);
  button.addEventListener('pointerleave', stop);
  button.addEventListener('pointercancel', stop);
  document.addEventListener('pointerup', stop);
}
