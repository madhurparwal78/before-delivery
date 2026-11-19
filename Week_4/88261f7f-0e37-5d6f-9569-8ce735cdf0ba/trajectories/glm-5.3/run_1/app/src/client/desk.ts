import { ApiRequest, errorText } from './api.js';
import { el, status } from './ui.js';
import type { App } from './main.js';
import { setDeskNotice, registerDeskNotice, navigate, rememberDeskNotice } from './main.js';
import type { DeskData, TimelineData, TimelineRoom, TimelineBlock, Stay, Folio, Entry, RatePlan, CloseResult } from './types.js';
import { formatMoney, addDays, dateRange } from './types.js';
import { openStayPanel, forceClosePanels } from './stayPanel.js';
import { openNewStayDialog } from './newStay.js';
import { openRoomStatusDialog } from './roomStatus.js';

interface DeskState {
  desk: DeskData | null;
  timeline: TimelineData | null;
  windowStart: string;
  notice: string;
  currentCell: { roomId: string; date: string } | null;
}

const NIGHTS_SHOWN = 14;

let state: DeskState = { desk: null, timeline: null, windowStart: '', notice: '', currentCell: null };
let nodes: {
  businessDate: HTMLElement; freeRooms: HTMLElement; notices: HTMLElement; closeStatus: HTMLElement;
  timelineWrap: HTMLElement; todayPanel: HTMLElement; tallyRail: HTMLElement;
  main: HTMLElement; newStayBtn: HTMLButtonElement; runCloseBtn: HTMLButtonElement | null;
} | null = null;
let pendingClose = false;

export async function renderDesk(app: App): Promise<void> {
  currentApp = app;
  await refreshDeskData();
  const bd = state.desk?.hotel.businessDate ?? '';
  state.windowStart = addDays(bd, -1);

  const isOwner = app.user?.role === 'owner';
  const businessDate = status(state.desk?.hotel.businessDate ?? '');
  businessDate.setAttribute('role', 'status');
  const freeRooms = status(state.desk?.freeRoomsText ?? '');
  freeRooms.setAttribute('role', 'status');
  const notices = status('');
  notices.id = 'desk-notices';
  const closeStatusNode = status('');
  closeStatusNode.id = 'close-status';

  const newStayBtn = el('button', { text: 'New stay' }) as HTMLButtonElement;
  newStayBtn.addEventListener('click', () => openNewStayDialog());
  let runCloseBtn: HTMLButtonElement | null = null;
  if (isOwner) {
    runCloseBtn = el('button', { text: 'Run close' }) as HTMLButtonElement;
    runCloseBtn.addEventListener('click', () => runClose(app));
  }

  const isPhone = window.matchMedia('(max-width: 700px)').matches;
  const isTablet = !isPhone && window.matchMedia('(max-width: 1024px)').matches;
  const timelineWrap = el('div', { class: 'timeline-frame' });
  const todayPanel = el('aside', { class: 'today-panel' });
  const phoneRooms = el('ul', { class: 'phone-list', 'aria-label': "Today's rooms" });
  const tallyRail = buildTallyRail();
  const todayToggle = el('button', { text: 'Today' }) as HTMLButtonElement;
  todayToggle.addEventListener('click', () => {
    todayPanel.style.display = todayPanel.style.display === 'block' ? 'none' : 'block';
  });

  const topbar = el('div', { class: 'topbar' },
    el('span', { class: 'brand', text: 'Nightroll' }),
    el('span', { class: 'spacer' }),
    el('span', {}, el('b', { text: 'Business date ' }), businessDate),
    el('span', {}, el('b', { text: 'Free rooms ' }), freeRooms),
    newStayBtn,
    isTablet ? todayToggle : null,
    runCloseBtn
  );
  const noticesLine = el('div', { class: 'notices-line' }, notices, closeStatusNode);

  const columns = isPhone
    ? el('div', { class: 'desk-columns full' }, phoneRooms)
    : el('div', { class: 'desk-columns' }, timelineWrap, isTablet ? el('div') : todayPanel);
  if (isTablet) {
    todayPanel.style.display = 'none';
    todayPanel.classList.add('tablet-overlay');
    columns.append(todayPanel);
  }
  const main = el('main', { 'data-ground': 'day', 'data-close-phase': 'idle' }, columns, tallyRail);
  main.id = 'desk-main';

  const shellEl = el('div', {},
    el('div', { class: 'topbar' },
      el('span', { class: 'brand', text: 'Nightroll' }),
      buildNav(app),
      el('span', { class: 'spacer' }),
      el('span', { text: app.user?.name ?? '' }),
      el('button', { text: 'Sign out', onclick: () => { void signOutAction(app); } })),
    topbar,
    noticesLine,
    main
  );
  app.root.replaceChildren(shellEl);

  nodes = {
    businessDate, freeRooms, notices, closeStatus: closeStatusNode,
    timelineWrap, todayPanel, tallyRail, main, newStayBtn, runCloseBtn
  };
  registerDeskNotice(notices);
  app.refreshDesk = refreshFromLive;
  renderTimeline();
  renderToday();
  await loadTally();
  attachKeyboard(app);
}

async function signOutAction(app: App): Promise<void> {
  await ApiRequest.del('/api/session');
  app.user = null;
  navigate('/');
}

function buildNav(app: App): HTMLElement {
  const nav = el('nav', { 'aria-label': 'Main' });
  const links: Array<[string, string, string[]]> = [
    ['Desk', '/desk', ['owner', 'front_desk']],
    ['Guests', '/guests', ['owner', 'front_desk']],
    ['Rates', '/rates', ['owner']],
    ['Reports', '/reports', ['owner']],
    ['Board', '/board', ['owner', 'front_desk', 'housekeeper']]
  ];
  for (const [label, path, roles] of links) {
    if (!app.user || !roles.includes(app.user.role)) continue;
    const a = el('a', { href: path, text: label });
    if (window.location.pathname === path) a.classList.add('current');
    a.addEventListener('click', ev => { ev.preventDefault(); navigate(path); });
    nav.append(a);
  }
  return nav;
}

export async function refreshDeskData(): Promise<void> {
  const deskRes = await ApiRequest.get('/api/desk');
  if (deskRes.status === 200) state.desk = deskRes.data as DeskData;
  const bd = state.desk?.hotel.businessDate ?? '';
  if (bd && !state.windowStart) state.windowStart = addDays(bd, -1);
  if (bd) {
    const from = state.windowStart || addDays(bd, -1);
    const to = addDays(from, NIGHTS_SHOWN - 1);
    const tlRes = await ApiRequest.get(`/api/timeline?from=${from}&to=${to}`);
    if (tlRes.status === 200) state.timeline = tlRes.data as TimelineData;
  }
}

async function refreshFromLive(): Promise<void> {
  await refreshDeskData();
  if (nodes) {
    nodes.businessDate.textContent = state.desk?.hotel.businessDate ?? '';
    nodes.freeRooms.textContent = state.desk?.freeRoomsText ?? '';
    renderTimeline();
    renderToday();
    renderPhoneRooms();
  }
}

export function renderTimeline(): void {
  if (!nodes || !state.timeline) return;
  const tl = state.timeline;
  const dates = tl.dates;
  const bd = tl.businessDate;

  const table = el('table', { class: 'timeline', role: 'grid', 'aria-label': 'Reservation timeline' }) as HTMLTableElement;
  const headRow = el('tr');
  const corner = el('th', { class: 'roomhead', scope: 'row', text: '' });
  corner.setAttribute('tabindex', '-1');
  corner.addEventListener('click', () => corner.focus());
  headRow.append(corner);
  for (const date of dates) {
    const th = el('th', { class: 'datehead', scope: 'col', text: date, tabindex: '-1' });
    th.setAttribute('data-date', date);
    th.addEventListener('click', () => {
      const cell = currentCell();
      if (cell) setCurrentCell(cell.roomId, date);
      th.focus();
    });
    if (date === bd) th.setAttribute('data-business-date', 'true');
    headRow.append(th);
  }
  const thead = el('thead');
  thead.append(headRow);
  table.append(thead);

  const tbody = el('tbody');
  for (const room of tl.rooms) {
    const row = el('tr');
    row.setAttribute('data-room-id', room.id);
    row.setAttribute('data-room-type', room.type);
    const roomHead = el('th', { class: 'roomhead', scope: 'row' });
    roomHead.setAttribute('data-room-id', room.id);
    const roomLabel = el('span', { class: 'serif', text: room.number });
    const chip = el('button', {
      class: 'chip', 'aria-label': `Room ${room.number} status: ${room.status.replace('_', ' ')}`,
      'data-status': room.status, text: room.status.replace('_', ' ')
    });
    chip.addEventListener('click', () => openRoomStatusDialog(room, chip));
    roomHead.append(roomLabel, ' ', chip);
    row.append(roomHead);
    for (const date of dates) {
      const td = el('td', { class: 'cell', role: 'gridcell', tabindex: '-1' });
      td.setAttribute('data-date', date);
      td.setAttribute('data-room-id', room.id);
      if (state.currentCell && state.currentCell.roomId === room.id && state.currentCell.date === date) {
        td.classList.add('current');
      }
      const stamp = tl.stamps.find(s => s.roomId === room.id && s.date === date);
      if (stamp) {
        if (stamp.stamp === 'tick' || stamp.stamp === null) {
          td.setAttribute('data-stamp', 'tick');
          td.append(el('span', { class: 'tick', text: '·' }));
        } else {
          td.setAttribute('data-stamp', stamp.stamp);
          td.append(el('span', { class: 'stamp', text: stamp.stamp }));
        }
      }
      // blocks starting on this cell
      td.addEventListener('click', () => {
        setCurrentCell(room.id, date);
        td.focus();
      });
      const starting = tl.blocks.filter(b => b.roomId === room.id && b.firstNight === date);
      for (const block of starting) {
        const btn = el('button', {
          class: 'stay-block', type: 'button',
          'aria-label': `Stay ${block.guestName}, room ${room.number}, ${blockLabel(block)}`,
          'data-stay-id': block.stayId,
          'data-room-id': room.id,
          'data-first-night': block.firstNight,
          'data-nights': block.nights,
          'data-status': block.status,
          text: block.guestName
        });
        if (block.status === 'booked' || block.status === 'in_house') {
          btn.style.gridColumn = `1 / span 1`;
          btn.style.width = `calc(${block.nights} * (72px + 1px) - 4px)`;
        }
        if (block.checkedInOnline) btn.setAttribute('data-checked-in-online', 'true');
        if (pickedUp && pickedUp.stayId === block.stayId) btn.setAttribute('data-picked-up', 'true');
        btn.addEventListener('click', ev => {
          ev.stopPropagation();
          setCurrentCell(room.id, block.firstNight);
          openStayPanel(block.stayId);
        });
        btn.addEventListener('keydown', ev => {
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ev.stopPropagation(); openStayPanel(block.stayId); }
        });
        td.append(btn);
      }
      row.append(td);
    }
    tbody.append(row);
  }
  table.append(tbody);

  // window shift buttons in the header row
  const prevBtn = el('button', { text: 'Previous nights', 'aria-label': 'Previous nights' });
  prevBtn.addEventListener('click', () => shiftWindow(-7));
  const nextBtn = el('button', { text: 'Next nights', 'aria-label': 'Next nights' });
  nextBtn.addEventListener('click', () => shiftWindow(7));

  const grid = el('div', { role: 'grid', 'aria-label': 'Reservation timeline' });
  grid.setAttribute('aria-readonly', 'true');
  const gridTableWrap = el('div', { class: 'timeline-frame-inner' });
  gridTableWrap.append(table);
  grid.append(gridTableWrap);
  nodes.timelineWrap.replaceChildren(grid);

  // header row buttons: place them above the table as part of the grid's header row
  const headerRow = el('div', { class: 'tl-header-row', role: 'row' });
  headerRow.append(prevBtn, nextBtn);
  nodes.timelineWrap.prepend(headerRow);
}

function blockLabel(block: TimelineBlock): string {
  const dep = addDays(block.firstNight, block.nights);
  return `${block.firstNight} to ${dep}`;
}

function shiftWindow(nights: number): void {
  const bd = state.desk?.hotel.businessDate;
  if (!bd) return;
  state.windowStart = addDays(state.windowStart, nights);
  void refreshDeskData().then(() => renderTimeline());
}

export function setCurrentCell(roomId: string, date: string): void {
  state.currentCell = { roomId, date };
  if (nodes) {
    for (const cell of Array.from(nodes.timelineWrap.querySelectorAll('.cell'))) {
      const c = cell as HTMLElement;
      c.classList.toggle('current', c.getAttribute('data-room-id') === roomId && c.getAttribute('data-date') === date);
    }
  }
}

export function currentCell(): { roomId: string; date: string } | null {
  if (state.currentCell) return state.currentCell;
  const tl = state.timeline;
  const bd = state.desk?.hotel.businessDate ?? '';
  if (!tl || !bd) return null;
  const firstRoom = tl.rooms[0];
  if (!firstRoom) return null;
  return { roomId: firstRoom.id, date: bd };
}

export function timeline(): TimelineData | null { return state.timeline; }
export function deskData(): DeskData | null { return state.desk; }
export function deskNotice(): string { return state.notice; }
export function setNotice(text: string): void {
  state.notice = text;
  setDeskNotice(text);
  rememberDeskNotice(text);
}

// ---- pick-up (M key) ----
interface Pickup { stayId: string; roomId: string; firstNight: string; nights: number; guestName: string; status: string; datesShifted: number }
let pickedUp: Pickup | null = null;
let pickupOriginal: Pickup | null = null;

export function pickupHere(): boolean { return pickedUp !== null; }

export function currentBlockAt(cell: { roomId: string; date: string }): TimelineBlock | null {
  const tl = state.timeline;
  if (!tl) return null;
  return tl.blocks.find(b =>
    (b.status === 'booked' || b.status === 'in_house') &&
    b.roomId === cell.roomId &&
    cell.date >= b.firstNight &&
    cell.date < addDays(b.firstNight, b.nights)) ?? null;
}

export function pickupStay(): void {
  const cell = currentCell();
  if (!cell) return;
  const block = currentBlockAt(cell);
  if (!block) {
    setNotice('No stay here.');
    return;
  }
  forceClosePanels();
  pickupOriginal = { stayId: block.stayId, roomId: block.roomId, firstNight: block.firstNight, nights: block.nights, guestName: block.guestName, status: block.status, datesShifted: 0 };
  pickedUp = { ...pickupOriginal };
  setNotice(`Picked up ${block.guestName}.`);
  renderTimeline();
  focusGridFrame();
}

export function movePickup(dr: 'up' | 'down' | 'left' | 'right'): void {
  if (!pickedUp || !state.timeline) return;
  const tl = state.timeline;
  const rooms = tl.rooms;
  if (dr === 'up' || dr === 'down') {
    const idx = rooms.findIndex(r => r.id === pickedUp!.roomId);
    const next = dr === 'up' ? rooms[idx - 1] : rooms[idx + 1];
    if (!next) return;
    pickedUp.roomId = next.id;
    const dateIn = pickedUp.firstNight;
    setNotice(`Over room ${next.number}, ${dateIn}.`);
    renderTimeline();
    focusGridFrame();
    return;
  }
  if (pickedUp.status !== 'booked') return;
  const dir = dr === 'left' ? -1 : 1;
  const newFirst = addDays(pickedUp.firstNight, dir);
  const bd = state.desk?.hotel.businessDate ?? '';
  if (newFirst < bd) return;
  pickedUp.firstNight = newFirst;
  pickedUp.datesShifted += dir;
  setNotice(`Over room ${roomNumberOf(pickedUp.roomId)}, ${newFirst}.`);
  renderTimeline();
  focusGridFrame();
}

function roomNumberOf(roomId: string): string {
  return state.timeline?.rooms.find(r => r.id === roomId)?.number ?? '';
}

export function announcePlacement(): void {
  if (!pickedUp) return;
  setNotice(`Over room ${roomNumberOf(pickedUp.roomId)}, ${pickedUp.firstNight}.`);
}

export function cancelPickup(): void {
  if (!pickedUp) return;
  pickedUp = null;
  pickupOriginal = null;
  setNotice('Move cancelled.');
  renderTimeline();
}

export async function dropPickup(app: App): Promise<void> {
  if (!pickedUp || !pickupOriginal) return;
  const p = pickedUp;
  const original = pickupOriginal;
  if (p.roomId === original.roomId && p.firstNight === original.firstNight) {
    pickedUp = null;
    pickupOriginal = null;
    setNotice('Move cancelled.');
    renderTimeline();
    return;
  }
  setNotice('Moving stay…');
  const body: Record<string, unknown> = { version: await stayVersion(p.stayId), roomId: p.roomId };
  if (p.status === 'booked' && p.datesShifted !== 0) {
    body.arrival = p.firstNight;
  }
  if (p.status === 'in_house') {
    body.fromNight = state.desk?.hotel.businessDate;
  }
  const res = await ApiRequest.post(`/api/stays/${p.stayId}/move`, body);
  pickedUp = null;
  pickupOriginal = null;
  if (res.status === 200) {
    const stay = res.data as Stay;
    setNotice(`Moved ${stay.guest.name} to room ${stay.segments[stay.segments.length - 1]?.roomNumber ?? roomNumberOf(p.roomId)}.`);
  } else {
    setNotice(errorText(res.data) ?? 'Move failed.');
  }
  await refreshDeskData();
  renderTimeline();
  renderToday();
}

async function stayVersion(stayId: string): Promise<number> {
  const block = state.timeline?.blocks.find(b => b.stayId === stayId);
  if (block) return block.version;
  const res = await ApiRequest.get(`/api/stays/${stayId}`);
  if (res.status === 200) return (res.data as Stay).version;
  return 1;
}

// ---- keyboard ----
let keyboardAttached = false;
function attachKeyboard(app: App): void {
  if (keyboardAttached) return;
  keyboardAttached = true;
  document.addEventListener('keydown', onKeydown);
}

export function detachKeyboard(): void {
  document.removeEventListener('keydown', onKeydown);
}

function onKeydown(ev: KeyboardEvent): void {
  if (ev.ctrlKey || ev.altKey || ev.metaKey) return;
  const target = ev.target as HTMLElement;
  const inTimeline = target.closest('.timeline-frame') !== null;
  if (!inTimeline) return;
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;
  const key = ev.key;
  if (pickedUp) {
    if (key === 'ArrowUp') { ev.preventDefault(); movePickup('up'); return; }
    if (key === 'ArrowDown') { ev.preventDefault(); movePickup('down'); return; }
    if (key === 'ArrowLeft') { ev.preventDefault(); movePickup('left'); return; }
    if (key === 'ArrowRight') { ev.preventDefault(); movePickup('right'); return; }
    if (key === 'Enter') { ev.preventDefault(); void dropPickup(currentApp!); return; }
    if (key === 'Escape') { ev.preventDefault(); cancelPickup(); return; }
    return;
  }
  const cell = currentCell();
  if (!cell) return;
  if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight') {
    ev.preventDefault();
    moveCurrentCell(key);
    return;
  }
  if (key === 'n' || key === 'N') { ev.preventDefault(); openNewStayDialog(cell.roomId, cell.date); return; }
  if (key === 'm' || key === 'M') { ev.preventDefault(); pickupStay(); return; }
  if (key === 'i' || key === 'I') { ev.preventDefault(); void checkInCurrent(); return; }
  if (key === 'o' || key === 'O') { ev.preventDefault(); void checkOutCurrent(); return; }
  if (key === 'Enter') {
    ev.preventDefault();
    const block = currentBlockAt(cell);
    if (block) openStayPanel(block.stayId);
    else openNewStayDialog(cell.roomId, cell.date);
    return;
  }
}

let currentApp: App | null = null;

function moveCurrentCell(key: string): void {
  const tl = state.timeline;
  if (!tl) return;
  const cell = currentCell();
  if (!cell) return;
  const roomIdx = tl.rooms.findIndex(r => r.id === cell.roomId);
  const dateIdx = tl.dates.indexOf(cell.date);
  if (key === 'ArrowUp' && roomIdx > 0) setCurrentCell(tl.rooms[roomIdx - 1].id, cell.date);
  if (key === 'ArrowDown' && roomIdx < tl.rooms.length - 1) setCurrentCell(tl.rooms[roomIdx + 1].id, cell.date);
  if (key === 'ArrowLeft' && dateIdx > 0) setCurrentCell(cell.roomId, tl.dates[dateIdx - 1]);
  if (key === 'ArrowRight' && dateIdx < tl.dates.length - 1) setCurrentCell(cell.roomId, tl.dates[dateIdx + 1]);
  if (dateIdx === 0 && key === 'ArrowLeft') shiftWindow(-7);
  if (dateIdx === tl.dates.length - 1 && key === 'ArrowRight') shiftWindow(7);
  focusCurrentCell();
}

export function focusGridFrame(): void {
  if (!nodes) return;
  const anyCell = nodes.timelineWrap.querySelector('[tabindex]') as HTMLElement | null;
  if (anyCell) anyCell.focus();
}

export function focusCurrentCell(): void {
  if (!nodes) return;
  const cell = currentCell();
  if (!cell) return;
  const target = nodes.timelineWrap.querySelector(
    `.cell[data-room-id="${cell.roomId}"][data-date="${cell.date}"]`) as HTMLElement | null;
  if (target) target.focus?.();
}

async function checkInCurrent(): Promise<void> {
  const cell = currentCell();
  if (!cell) return;
  const block = currentBlockAt(cell);
  if (!block) { setNotice('No stay here.'); return; }
  setNotice('Checking in…');
  const res = await ApiRequest.post(`/api/stays/${block.stayId}/check-in`);
  if (res.status === 200) {
    const stay = res.data as Stay;
    setNotice(`Checked in ${stay.guest.name} to room ${stay.segments[0]?.roomNumber ?? ''}.`);
  } else {
    setNotice(errorText(res.data) ?? 'Check-in failed.');
  }
  await refreshDeskData();
  renderTimeline();
  renderToday();
}

async function checkOutCurrent(): Promise<void> {
  const cell = currentCell();
  if (!cell) return;
  const block = currentBlockAt(cell);
  if (!block) { setNotice('No stay here.'); return; }
  setNotice('Checking out…');
  const res = await ApiRequest.post(`/api/stays/${block.stayId}/check-out`);
  if (res.status === 200) {
    const stay = res.data as Stay;
    setNotice(`Checked out ${stay.guest.name} from room ${stay.segments[stay.segments.length - 1]?.roomNumber ?? ''}.`);
  } else {
    setNotice(errorText(res.data) ?? 'Check-out failed.');
  }
  await refreshDeskData();
  renderTimeline();
  renderToday();
}

// ---- today panel ----
export function renderPhoneRooms(): void {
  if (!nodes || !state.timeline) return;
  const tl = state.timeline;
  const bd = tl.businessDate;
  const rooms = tl.rooms.slice().sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
  const phoneRooms = document.querySelector('.phone-list') as HTMLElement | null;
  if (!phoneRooms) return;
  phoneRooms.replaceChildren();
  for (const room of rooms) {
    const block = tl.blocks.find(b => b.roomId === room.id && bd >= b.firstNight && bd < addDays(b.firstNight, b.nights) && (b.status === 'booked' || b.status === 'in_house'));
    const li = el('li', {},
      el('span', { class: 'serif', text: room.number }),
      ' ',
      el('span', { class: 'chip', 'data-status': room.status, text: room.status.replace('_', ' ') }));
    if (block) {
      const openBtn = el('button', { text: `Open stay ${block.guestName}`, 'aria-label': `Open stay ${block.guestName}` }) as HTMLButtonElement;
      openBtn.addEventListener('click', () => openStayPanel(block.stayId));
      const ciBtn = el('button', { text: `Check in ${block.guestName}`, 'aria-label': `Check in ${block.guestName}` }) as HTMLButtonElement;
      ciBtn.addEventListener('click', async () => {
        setNotice('Checking in…');
        const res = await ApiRequest.post(`/api/stays/${block.stayId}/check-in`);
        if (res.status === 200) {
          const stay = res.data as Stay;
          setNotice(`Checked in ${stay.guest.name} to room ${stay.segments[0]?.roomNumber ?? ''}.`);
        } else {
          setNotice(errorText(res.data) ?? 'Check-in failed.');
        }
        await refreshDeskData();
        renderTimeline();
        renderToday();
      });
      const coBtn = el('button', { text: `Check out ${block.guestName}`, 'aria-label': `Check out ${block.guestName}` }) as HTMLButtonElement;
      coBtn.addEventListener('click', async () => {
        setNotice('Checking out…');
        const res = await ApiRequest.post(`/api/stays/${block.stayId}/check-out`);
        if (res.status === 200) {
          const stay = res.data as Stay;
          setNotice(`Checked out ${stay.guest.name} from room ${stay.segments[stay.segments.length - 1]?.roomNumber ?? ''}.`);
        } else {
          setNotice(errorText(res.data) ?? 'Check-out failed.');
        }
        await refreshDeskData();
        renderTimeline();
        renderToday();
      });
      li.append(el('span', { class: 'who', text: `${block.guestName} · ${block.firstNight} to ${addDays(block.firstNight, block.nights)}` }), openBtn, ciBtn, coBtn);
    } else {
      li.append(el('span', { class: 'who', text: 'Vacant' }));
    }
    phoneRooms.append(li);
  }
}

export function renderToday(): void {
  if (!nodes || !state.timeline) return;
  renderPhoneRooms();
  const tl = state.timeline;
  const bd = tl.businessDate;
  const arrivals: string[] = [];
  const departures: string[] = [];
  for (const block of tl.blocks) {
    if (block.firstNight === bd) arrivals.push(block.guestName);
    const dep = addDays(block.firstNight, block.nights);
    if (dep === bd) departures.push(block.guestName);
  }
  const list = (title: string, names: string[]) =>
    el('div', {}, el('h3', { text: title }),
      names.length ? el('ul', {}, ...names.map(n => el('li', { text: n }))) : el('p', { text: '—' }));
  nodes.todayPanel.replaceChildren(
    el('h3', { text: 'Today' }),
    list(`Arrivals ${bd}`, arrivals),
    list(`Departures ${bd}`, departures)
  );
  nodes.todayPanel.setAttribute('role', 'complementary');
  nodes.todayPanel.setAttribute('aria-label', 'Today');
}

// ---- tally rail ----
function buildTallyRail(): HTMLElement {
  const rail = el('div', { class: 'tally-rail', role: 'region', 'aria-label': 'Tally rail' });
  const mk = (label: string, id: string) => {
    const s = status('—');
    s.id = id;
    return el('span', { class: 't' }, el('b', { text: label }), s);
  };
  rail.append(
    mk('Date', 'tally-date'), mk('Rooms sold', 'tally-rooms-sold'), mk('Room revenue', 'tally-room-revenue'),
    mk('Occupancy', 'tally-occupancy'), mk('Average daily rate', 'tally-adr'), mk('RevPAR', 'tally-revpar')
  );
  return rail;
}

async function loadTally(): Promise<void> {
  const desk = state.desk;
  const bd = desk?.hotel.businessDate;
  if (!bd || !nodes) return;
  const last = addDays(bd, -1);
  const res = await ApiRequest.get(`/api/reports?from=${last}&to=${last}`);
  if (res.status !== 200) return;
  const data = res.data;
  const set = (id: string, value: string) => {
    const node = nodes?.tallyRail.querySelector(`#${id}`);
    if (node) node.textContent = value;
  };
  set('tally-date', `Last closed night ${last}`);
  set('tally-rooms-sold', String(data.roomsSold));
  set('tally-room-revenue', formatMoney(data.roomRevenueCents));
  set('tally-occupancy', data.occupancy);
  set('tally-adr', data.averageDailyRate);
  set('tally-revpar', data.revenuePerAvailableRoom);
}

// ---- close ----
async function runClose(app: App): Promise<void> {
  if (pendingClose || !nodes?.runCloseBtn) return;
  pendingClose = true;
  nodes.runCloseBtn.setAttribute('aria-busy', 'true');
  const bd = state.desk?.hotel.businessDate ?? '';
  nodes.closeStatus.textContent = 'Running close…';
  const res = await ApiRequest.post('/api/close', { businessDate: bd });
  pendingClose = false;
  if (nodes?.runCloseBtn) nodes.runCloseBtn.removeAttribute('aria-busy');
  if (res.status !== 200) {
    const data = res.data as (CloseResult & { error?: string; blockers?: Array<{ roomNumber: string }> });
    if (data?.blockers && data.blockers.length > 0) {
      markBlockedRows(data.blockers.map(b => b.roomNumber));
      nodes.closeStatus.textContent = data.error ?? 'Close blocked.';
      focusFirstBlockedRow();
    } else {
      nodes.closeStatus.textContent = data?.error ?? 'Close failed.';
    }
    return;
  }
  const result = res.data as CloseResult;
  const text = `Business date ${result.businessDate} closed. ${result.roomsCharged} ${result.roomsCharged === 1 ? 'room' : 'rooms'} charged. ${result.noShows} ${result.noShows === 1 ? 'no-show' : 'no-shows'}.`;
  if (nodes) nodes.closeStatus.textContent = text;
  await playCloseSweep(result, app);
}

function markBlockedRows(roomNumbers: string[]): void {
  if (!nodes) return;
  for (const row of Array.from(nodes.timelineWrap.querySelectorAll('tr[data-room-id]'))) {
    const r = row as HTMLElement;
    const roomNumber = r.querySelector('.roomhead .serif')?.textContent ?? '';
    if (roomNumbers.includes(roomNumber)) r.setAttribute('data-blocked', 'true');
  }
}

function focusFirstBlockedRow(): void {
  if (!nodes) return;
  const blocked = nodes.timelineWrap.querySelector('tr[data-blocked="true"] .roomhead');
  if (blocked instanceof HTMLElement) blocked.focus();
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function playCloseSweep(result: CloseResult, app: App): Promise<void> {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  await refreshDeskData();
  if (reduced || app.user?.role !== 'owner') {
    // end state at once
    if (nodes) {
      nodes.businessDate.textContent = state.desk?.hotel.businessDate ?? result.newBusinessDate;
      nodes.freeRooms.textContent = state.desk?.freeRoomsText ?? '';
      nodes.main.setAttribute('data-close-phase', 'idle');
      nodes.main.setAttribute('data-ground', 'day');
      renderTimeline();
      renderToday();
      await loadTally();
      showCloseResults(result);
    }
    return;
  }
  const main = nodes!.main;
  // phase: night
  main.setAttribute('data-close-phase', 'night');
  main.setAttribute('data-ground', 'night');
  await sleep(300);
  // phase: stamping
  main.setAttribute('data-close-phase', 'stamping');
  const stampOrder = [...result.rows].sort((a, b) => a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }));
  const step = Math.min(1500 / Math.max(1, stampOrder.length), 100);
  for (const row of stampOrder) {
    stampCell(row.roomId, formatMoney(row.postedCents));
    await sleep(step);
  }
  await countUpTally(result);
  await sleep(300);
  // phase: slide
  main.setAttribute('data-close-phase', 'slide');
  state.windowStart = addDays(state.windowStart, 1);
  await refreshDeskData();
  renderTimeline();
  renderToday();
  main.setAttribute('data-ground', 'day');
  await sleep(300);
  main.setAttribute('data-close-phase', 'idle');
  await loadTally();
  showCloseResults(result);
}

function stampCell(roomId: string, amount: string): void {
  if (!nodes) return;
  const bd = state.desk?.hotel.businessDate;
  if (!bd) return;
  const cell = nodes.timelineWrap.querySelector(`.cell[data-room-id="${roomId}"][data-date="${bd}"]`);
  if (cell) {
    cell.setAttribute('data-stamp', amount);
    const existing = cell.querySelector('.stamp');
    if (existing) existing.textContent = amount;
    else cell.append(el('span', { class: 'stamp', text: amount }));
  }
}

async function countUpTally(result: CloseResult): Promise<void> {
  if (!nodes) return;
  nodes.tallyRail.setAttribute('aria-busy', 'true');
  const figures = result.figures;
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    const frac = i / steps;
    setTallyValue('tally-date', `Last closed night ${result.businessDate}`);
    setTallyValue('tally-rooms-sold', String(Math.round(figures.roomsSold * frac)));
    setTallyValue('tally-room-revenue', formatMoney(Math.round(figures.roomRevenueCents * frac)));
    setTallyValue('tally-occupancy', figures.occupancy);
    setTallyValue('tally-adr', figures.averageDailyRate);
    setTallyValue('tally-revpar', figures.revenuePerAvailableRoom);
    await sleep(40);
  }
  nodes.tallyRail.setAttribute('aria-busy', 'false');
}

function setTallyValue(id: string, value: string): void {
  if (!nodes) return;
  const node = nodes.tallyRail.querySelector(`#${id}`);
  if (node) node.textContent = value;
}

function showCloseResults(result: CloseResult): void {
  if (!nodes) return;
  const existing = document.getElementById('close-results');
  existing?.remove();
  const table = el('table', { class: 'data', 'aria-label': 'Close results', id: 'close-results' });
  const thead = el('thead', {}, el('tr', {}, el('th', { text: 'Room' }), el('th', { class: 'num', text: 'Posted' })));
  const tbody = el('tbody');
  for (const row of result.rows) {
    tbody.append(el('tr', {},
      el('td', { text: row.roomNumber }),
      el('td', { class: 'num', text: formatMoney(row.postedCents) })));
  }
  table.append(thead, tbody);
  nodes.main.append(table);
}
