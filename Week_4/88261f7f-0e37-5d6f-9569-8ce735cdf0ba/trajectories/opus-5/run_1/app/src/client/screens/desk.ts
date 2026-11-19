import { addDays, daysBetween, PlainDate } from '../../shared/dates';
import { NO_FIGURE } from '../../shared/figures';
import { formatMoney } from '../../shared/money';
import { notices, pendingTexts } from '../../shared/notices';
import { call } from '../api';
import {
  loadDesk,
  loadTimeline,
  render,
  state,
  TIMELINE_NIGHTS,
  WINDOW_STEP,
} from '../app';
import { button, el } from '../dom';
import { openRoomStatus } from '../dialogs/roomStatus';
import { openNewStay } from '../newStay';
import { regionNames, setMessage, statusRegion } from '../regions';
import { RoomStatus, roomStatusWords } from '../../shared/roomStatus';
import { flashOnStatusChange } from '../statusFlash';
import { openStayPanel } from '../stayPanel';
import { runClose } from '../closeSweep';
import { Stay, TimelineBlock, TimelineRoom } from '../types';
import { shell } from './shell';

let gridNode: HTMLElement | null = null;
let frameNode: HTMLElement | null = null;
let tabStop: HTMLElement | null = null;

function timeline() {
  return state.timeline;
}

function blockIn(roomId: string, date: PlainDate): TimelineBlock | null {
  const data = timeline();
  if (!data) return null;
  return (
    data.blocks.find(
      (block) =>
        block.roomId === roomId &&
        block.status !== 'cancelled' &&
        block.status !== 'no_show' &&
        block.firstNight <= date &&
        date < addDays(block.firstNight, block.nights),
    ) ?? null
  );
}

function currentBlock(): TimelineBlock | null {
  if (state.currentRoomId === null || state.currentDate === null) return null;
  return blockIn(state.currentRoomId, state.currentDate);
}

async function shiftWindow(days: number): Promise<void> {
  if (state.windowStart === null) return;
  state.windowStart = addDays(state.windowStart, days);
  await loadTimeline();
  render();
}

function roomIndex(roomId: string | null): number {
  const data = timeline();
  if (!data || roomId === null) return 0;
  const index = data.rooms.findIndex((room) => room.id === roomId);
  return index < 0 ? 0 : index;
}

function moveRoom(step: number): void {
  const data = timeline();
  if (!data || data.rooms.length === 0) return;
  const next = Math.min(Math.max(roomIndex(state.currentRoomId) + step, 0), data.rooms.length - 1);
  state.currentRoomId = data.rooms[next].id;
  render();
}

async function moveDate(step: number): Promise<void> {
  const data = timeline();
  if (!data || state.currentDate === null) return;
  if (step < 0) {
    if (state.focusZone === 'rack') {
      await shiftWindow(-WINDOW_STEP);
      return;
    }
    if (state.currentDate === data.dates[0]) {
      state.focusZone = 'rack';
      render();
      return;
    }
    state.currentDate = addDays(state.currentDate, -1);
    render();
    return;
  }
  if (state.focusZone === 'rack') {
    state.focusZone = 'cell';
    render();
    return;
  }
  const last = data.dates[data.dates.length - 1];
  state.currentDate = addDays(state.currentDate, 1);
  if (state.currentDate > last) {
    await shiftWindow(WINDOW_STEP);
    return;
  }
  render();
}

function announce(text: string): void {
  setMessage(regionNames.deskNotices, text);
}

function roomById(roomId: string): TimelineRoom | null {
  const data = timeline();
  if (!data) return null;
  return data.rooms.find((room) => room.id === roomId) ?? null;
}

function pickUpCurrent(): void {
  const block = currentBlock();
  if (!block) {
    announce(notices.noStayHere);
    return;
  }
  state.pickup = {
    stayId: block.stayId,
    status: block.status,
    guestName: block.guestName,
    nights: block.nights,
    originRoomId: block.roomId,
    originFirstNight: block.firstNight,
    roomId: block.roomId,
    firstNight: block.firstNight,
    version: block.version,
  };
  announce(notices.pickedUp(block.guestName));
  render();
}

function announcePlacement(): void {
  if (!state.pickup) return;
  const room = roomById(state.pickup.roomId);
  announce(notices.overCell(room ? room.number : '', state.pickup.firstNight));
}

function cancelPickup(): void {
  state.pickup = null;
  announce(notices.moveCancelled);
  render();
}

async function dropPickup(): Promise<void> {
  const pickup = state.pickup;
  if (!pickup) return;
  if (pickup.roomId === pickup.originRoomId && pickup.firstNight === pickup.originFirstNight) {
    cancelPickup();
    return;
  }
  state.pickup = null;
  const room = roomById(pickup.roomId);
  setMessage(regionNames.deskNotices, pendingTexts.moveStay);
  const shift = daysBetween(pickup.originFirstNight, pickup.firstNight);
  const body: Record<string, unknown> = { version: pickup.version, roomId: pickup.roomId };
  if (pickup.status === 'in_house') {
    body.fromNight = state.desk ? state.desk.hotel.businessDate : pickup.firstNight;
  } else if (shift !== 0) {
    body.arrival = pickup.firstNight;
  }
  const result = await call<Stay>(`/api/stays/${pickup.stayId}/move`, { method: 'POST', body });
  if (result.data) {
    announce(notices.moved(result.data.guest.name, room ? room.number : ''));
  } else {
    announce(result.error ?? Object.values(result.fieldErrors ?? {})[0] ?? 'Not found.');
  }
  await loadDesk();
  render();
}

function stayActionShortcut(action: 'check-in' | 'check-out'): void {
  const block = currentBlock();
  if (!block) {
    announce(notices.noStayHere);
    return;
  }
  const pending = action === 'check-in' ? pendingTexts.checkIn : pendingTexts.checkOut;
  setMessage(regionNames.deskNotices, pending);
  void call<Stay>(`/api/stays/${block.stayId}/${action}`, { method: 'POST' }).then(
    async (result) => {
      if (result.data) {
        const stay = result.data;
        const roomNumber =
          stay.segments.length > 0 ? stay.segments[stay.segments.length - 1].roomNumber : '';
        announce(
          action === 'check-in'
            ? notices.checkedIn(stay.guest.name, roomNumber)
            : notices.checkedOut(stay.guest.name, roomNumber),
        );
      } else {
        announce(result.error ?? 'Not found.');
      }
      await loadDesk();
      render();
    },
  );
}

function focusGrid(): void {
  restoreDeskFocus(true);
}

function openCurrentCell(): void {
  const block = currentBlock();
  if (block) {
    void openStayPanel(tabStop, block.stayId, focusGrid);
    return;
  }
  openNewStay(tabStop, { roomId: state.currentRoomId, arrival: state.currentDate }, focusGrid);
}

function onGridKeyDown(event: KeyboardEvent): void {
  if (event.ctrlKey || event.altKey || event.metaKey) return;
  const key = event.key;
  if (state.pickup) {
    switch (key) {
      case 'ArrowUp':
      case 'ArrowDown': {
        const data = timeline();
        if (!data) return;
        const index = data.rooms.findIndex((room) => room.id === state.pickup?.roomId);
        const next = Math.min(
          Math.max(index + (key === 'ArrowUp' ? -1 : 1), 0),
          data.rooms.length - 1,
        );
        state.pickup.roomId = data.rooms[next].id;
        announcePlacement();
        render();
        break;
      }
      case 'ArrowLeft':
      case 'ArrowRight': {
        if (state.pickup.status !== 'booked') break;
        state.pickup.firstNight = addDays(state.pickup.firstNight, key === 'ArrowLeft' ? -1 : 1);
        announcePlacement();
        render();
        break;
      }
      case 'Enter':
        void dropPickup();
        break;
      case 'Escape':
        cancelPickup();
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  switch (key) {
    case 'ArrowUp':
      moveRoom(-1);
      break;
    case 'ArrowDown':
      moveRoom(1);
      break;
    case 'ArrowLeft':
      void moveDate(-1);
      break;
    case 'ArrowRight':
      void moveDate(1);
      break;
    case 'Enter':
      if (state.focusZone === 'rack') {
        const room = state.currentRoomId ? roomById(state.currentRoomId) : null;
        if (room) openRoomStatus(tabStop, room, focusGrid);
      } else {
        openCurrentCell();
      }
      break;
    default: {
      const letter = key.toLowerCase();
      if (letter === 'n') {
        openNewStay(tabStop, { roomId: state.currentRoomId, arrival: state.currentDate }, focusGrid);
      } else if (letter === 'm') {
        pickUpCurrent();
      } else if (letter === 'i') {
        stayActionShortcut('check-in');
      } else if (letter === 'o') {
        stayActionShortcut('check-out');
      } else {
        return;
      }
    }
  }
  event.preventDefault();
}

interface PlacedBlock {
  block: TimelineBlock;
  roomId: string;
  firstNight: PlainDate;
  pickedUp: boolean;
}

function placedBlocks(): PlacedBlock[] {
  const data = timeline();
  if (!data) return [];
  return data.blocks.map((block) => {
    const pickup = state.pickup;
    const pickedUp =
      pickup !== null &&
      pickup.stayId === block.stayId &&
      pickup.originRoomId === block.roomId &&
      pickup.originFirstNight === block.firstNight;
    return {
      block,
      roomId: pickedUp && pickup ? pickup.roomId : block.roomId,
      firstNight: pickedUp && pickup ? pickup.firstNight : block.firstNight,
      pickedUp,
    };
  });
}

function blockButton(placed: PlacedBlock, visibleNights: number, offset: number): HTMLElement {
  const block = placed.block;
  const room = roomById(placed.roomId);
  const departure = addDays(block.firstNight, block.nights);
  const node = button(
    block.guestName,
    (event) => {
      event.stopPropagation();
      state.currentRoomId = placed.roomId;
      state.currentDate = placed.firstNight;
      state.focusZone = 'cell';
      void openStayPanel(event.currentTarget as HTMLElement, block.stayId, focusGrid);
    },
    {
      class: `stayblock status-${block.status}${placed.pickedUp ? ' pickedup' : ''}`,
      'aria-label': `Stay ${block.guestName}, room ${room ? room.number : ''}, ${block.firstNight} to ${departure}`,
      'data-stay-id': block.stayId,
      'data-room-id': placed.roomId,
      'data-first-night': placed.firstNight,
      'data-nights': block.nights,
      'data-status': block.status,
      'data-picked-up': placed.pickedUp ? 'true' : null,
      'data-checked-in-online': block.checkedInOnline ? 'true' : null,
      tabindex: '-1',
      style: `--span:${visibleNights};--offset:${offset}`,
    },
  );
  node.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    state.currentRoomId = placed.roomId;
    state.currentDate = placed.firstNight;
    armDrag(block, event);
  });
  return node;
}

const DRAG_THRESHOLD_PX = 4;

let dragging = false;

/** A press alone opens the stay; only a press that travels picks the block up. */
function armDrag(block: TimelineBlock, start: PointerEvent): void {
  const onMove = (event: PointerEvent): void => {
    if (
      Math.abs(event.clientX - start.clientX) < DRAG_THRESHOLD_PX &&
      Math.abs(event.clientY - start.clientY) < DRAG_THRESHOLD_PX
    ) {
      return;
    }
    stop();
    startDrag(block);
  };
  const stop = (): void => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', stop);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', stop);
}

function startDrag(block: TimelineBlock): void {
  if (dragging) return;
  dragging = true;
  state.pickup = {
    stayId: block.stayId,
    status: block.status,
    guestName: block.guestName,
    nights: block.nights,
    originRoomId: block.roomId,
    originFirstNight: block.firstNight,
    roomId: block.roomId,
    firstNight: block.firstNight,
    version: block.version,
  };
  announce(notices.pickedUp(block.guestName));
  render();

  const onMove = (event: PointerEvent): void => {
    const target = document.elementFromPoint(event.clientX, event.clientY);
    const cell = target ? (target.closest('[role="gridcell"]') as HTMLElement | null) : null;
    if (!cell || !state.pickup) return;
    const roomId = cell.getAttribute('data-room-id');
    const date = cell.getAttribute('data-date');
    if (!roomId || !date) return;
    const shift = state.pickup.status === 'booked' ? date : state.pickup.firstNight;
    if (state.pickup.roomId === roomId && state.pickup.firstNight === shift) return;
    state.pickup.roomId = roomId;
    state.pickup.firstNight = shift;
    announcePlacement();
    render();
  };
  const onUp = (): void => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    dragging = false;
    void dropPickup();
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

function timelineGrid(): HTMLElement {
  const data = timeline();
  const grid = el('div', { role: 'grid', 'aria-label': 'Reservation timeline', class: 'timeline' });
  if (!data) return grid;

  const stamps = new Map<string, string>();
  for (const stamp of data.stamps) stamps.set(`${stamp.date}|${stamp.roomId}`, stamp.stamp);
  const blocks = placedBlocks();
  const blocked = new Set(state.blockers.map((entry) => entry.roomId));
  const firstBlockedIndex = data.rooms.findIndex((room) => blocked.has(room.id));

  const headRow = el('div', { role: 'row', class: 'trow headrow' }, [
    el('div', { role: 'columnheader', class: 'keyrack', 'aria-label': 'Rooms' }, [
      button('Previous nights', () => void shiftWindow(-WINDOW_STEP), { tabindex: '-1', class: 'tiny' }),
      button('Next nights', () => void shiftWindow(WINDOW_STEP), { tabindex: '-1', class: 'tiny' }),
    ]),
    ...data.dates.map((date) =>
      el(
        'div',
        {
          role: 'columnheader',
          'data-date': date,
          'data-business-date': date === data.businessDate ? 'true' : null,
          class: date === data.businessDate ? 'daycol business' : 'daycol',
        },
        [date],
      ),
    ),
  ]);
  grid.append(headRow);

  data.rooms.forEach((room, rowIndex) => {
    const isBlocked = blocked.has(room.id);
    const onSeam = firstBlockedIndex >= 0 && rowIndex <= firstBlockedIndex;
    const row = el('div', {
      role: 'row',
      'data-room-id': room.id,
      'data-room-type': room.type,
      'data-blocked': isBlocked ? 'true' : null,
      class: isBlocked ? 'trow blockedrow' : 'trow',
    });
    const chip = button(
      roomStatusWords(room.status as RoomStatus),
      (event) => {
        event.stopPropagation();
        openRoomStatus(event.currentTarget as HTMLElement, room, focusGrid);
      },
      {
        class: `chip chip-${room.status}`,
        'aria-label': `Room ${room.number} status: ${roomStatusWords(room.status as RoomStatus)}`,
        tabindex: '-1',
      },
    );
    flashOnStatusChange(room.id, room.status, chip);
    const onRack = state.focusZone === 'rack' && state.currentRoomId === room.id;
    if (onRack) {
      chip.setAttribute('tabindex', '0');
      tabStop = chip;
    }
    const header = el(
      'div',
      {
        role: 'rowheader',
        class: onSeam ? 'keyrack seam' : 'keyrack',
        'aria-label': `Room ${room.number}`,
      },
      [el('span', { class: 'roomnumber', text: room.number }), chip],
    );
    row.append(header);

    for (const date of data.dates) {
      const stamp = stamps.get(`${date}|${room.id}`);
      const isCurrent =
        state.focusZone === 'cell' && state.currentRoomId === room.id && state.currentDate === date;
      const cell = el('div', {
        role: 'gridcell',
        'data-date': date,
        'data-room-id': room.id,
        'data-stamp': stamp ?? null,
        class: `cell${date === data.businessDate ? ' business' : ''}`,
        tabindex: isCurrent ? '0' : '-1',
      });
      if (stamp) cell.append(el('span', { class: 'stamp', text: stamp }));
      for (const placed of blocks) {
        if (placed.roomId !== room.id) continue;
        const start = placed.firstNight;
        const end = addDays(start, placed.block.nights);
        if (start > date || date >= end) continue;
        const visibleFrom = start < data.dates[0] ? data.dates[0] : start;
        if (visibleFrom !== date) continue;
        const lastDate = data.dates[data.dates.length - 1];
        const visibleTo = addDays(end, -1) > lastDate ? lastDate : addDays(end, -1);
        const span = daysBetween(visibleFrom, visibleTo) + 1;
        cell.append(blockButton(placed, span, 0));
      }
      const hosted = cell.querySelector<HTMLElement>('.stayblock');
      if (isCurrent) {
        if (hosted) {
          hosted.setAttribute('tabindex', '0');
          cell.setAttribute('tabindex', '-1');
          tabStop = hosted;
        } else {
          tabStop = cell;
        }
      }
      cell.addEventListener('click', () => {
        state.currentRoomId = room.id;
        state.currentDate = date;
        state.focusZone = 'cell';
        render();
      });
      row.append(cell);
    }
    grid.append(row);
  });

  grid.addEventListener('keydown', onGridKeyDown);
  return grid;
}

function todayPanel(): HTMLElement {
  const data = timeline();
  const businessDate = data ? data.businessDate : '';
  const arrivals = data
    ? data.blocks.filter((block) => block.firstNight === businessDate && block.status !== 'cancelled')
    : [];
  const departures = data
    ? data.blocks.filter(
        (block) => addDays(block.firstNight, block.nights) === businessDate && block.status !== 'cancelled',
      )
    : [];
  return el('aside', { role: 'complementary', 'aria-label': 'Today', class: 'todaypanel' }, [
    el('h2', { text: 'Today' }),
    el('h3', { text: 'Arrivals' }),
    el(
      'ul',
      { class: 'plain' },
      arrivals.map((block) => el('li', { text: `${block.guestName} — room ${roomNumberOf(block.roomId)}` })),
    ),
    el('h3', { text: 'Departures' }),
    el(
      'ul',
      { class: 'plain' },
      departures.map((block) => el('li', { text: `${block.guestName} — room ${roomNumberOf(block.roomId)}` })),
    ),
  ]);
}

function roomNumberOf(roomId: string): string {
  const room = roomById(roomId);
  return room ? room.number : '';
}

function tallyRail(): HTMLElement {
  const result = state.closeResult;
  const figures = result ? result.figures : null;
  const value = (text: string | undefined): string => text ?? NO_FIGURE;
  return el('section', { role: 'region', 'aria-label': 'Tally rail', class: 'tallyrail' }, [
    tally('Tally date', result ? `Last closed night ${result.businessDate}` : 'No night closed yet'),
    tally('Tally rooms sold', figures ? String(figures.roomsSold) : NO_FIGURE),
    tally('Tally room revenue', figures ? formatMoney(figures.roomRevenueCents) : NO_FIGURE),
    tally('Tally occupancy', value(figures?.occupancy)),
    tally('Tally average daily rate', value(figures?.averageDailyRate)),
    tally('Tally revenue per available room', value(figures?.revenuePerAvailableRoom)),
  ]);
}

function tally(name: string, text: string): HTMLElement {
  return el('div', { class: 'tallyitem' }, [
    el('span', { class: 'tallylabel', text: name.replace('Tally ', '') }),
    el('div', { role: 'status', 'aria-label': name, 'data-region': name, class: 'status amount' }, [
      text,
    ]),
  ]);
}

function closeResults(): HTMLElement | null {
  const result = state.closeResult;
  if (!result || !state.closeResultShown) return null;
  return el('table', { 'aria-label': 'Close results', class: 'grid-table' }, [
    el('thead', {}, [
      el('tr', {}, [el('th', { scope: 'col' }, ['Room']), el('th', { scope: 'col' }, ['Posted'])]),
    ]),
    el(
      'tbody',
      {},
      result.rows.map((row) =>
        el('tr', {}, [
          el('td', {}, [row.roomNumber]),
          el('td', { class: 'amount' }, [formatMoney(row.postedCents)]),
        ]),
      ),
    ),
  ]);
}

function todaysRooms(): HTMLElement {
  const data = timeline();
  const businessDate = data ? data.businessDate : '';
  const list = el('ul', { role: 'list', 'aria-label': "Today's rooms", class: 'roomlist' });
  if (!data) return list;
  for (const room of data.rooms) {
    const block = blockIn(room.id, businessDate);
    const children: Node[] = [
      el('span', { class: 'roomnumber', text: room.number }),
      button(
        roomStatusWords(room.status as RoomStatus),
        (event) => openRoomStatus(event.currentTarget as HTMLElement, room),
        {
          class: `chip chip-${room.status} touch`,
          'aria-label': `Room ${room.number} status: ${roomStatusWords(room.status as RoomStatus)}`,
        },
      ),
    ];
    if (block) {
      children.push(
        el('span', {
          class: 'guestline',
          text: `${block.guestName} ${block.firstNight} to ${addDays(block.firstNight, block.nights)}`,
        }),
        button(
          `Open stay ${block.guestName}`,
          (event) => void openStayPanel(event.currentTarget as HTMLElement, block.stayId),
          { class: 'touch' },
        ),
      );
      if (block.status === 'booked') {
        children.push(
          button(
            `Check in ${block.guestName}`,
            () => {
              state.currentRoomId = room.id;
              state.currentDate = businessDate;
              stayActionShortcut('check-in');
            },
            { class: 'touch' },
          ),
        );
      }
      if (block.status === 'in_house') {
        children.push(
          button(
            `Check out ${block.guestName}`,
            () => {
              state.currentRoomId = room.id;
              state.currentDate = businessDate;
              stayActionShortcut('check-out');
            },
            { class: 'touch' },
          ),
        );
      }
    } else {
      children.push(el('span', { class: 'guestline', text: 'Vacant' }));
    }
    list.append(el('li', { class: 'roomitem' }, children));
  }
  return list;
}

export function deskScreen(): HTMLElement {
  tabStop = null;
  const owner = state.user !== null && state.user.role === 'owner';
  const newStayButton = button('New stay', (event) =>
    openNewStay(event.currentTarget as HTMLElement, {
      roomId: state.currentRoomId,
      arrival: state.currentDate,
    }),
  );
  const extras: Node[] = [
    statusRegion(regionNames.businessDate, 'status businessdate'),
    statusRegion(regionNames.freeRooms),
    newStayButton,
  ];
  if (owner) {
    extras.push(
      button('Run close', (event) => void runClose(event.currentTarget as HTMLButtonElement)),
    );
  }
  if (state.layout === 'tablet') {
    extras.push(
      button('Today', () => {
        state.todayOpen = !state.todayOpen;
        render();
      }),
    );
  }

  const main = el('main', {
    'data-ground': state.ground,
    'data-close-phase': state.closePhase,
    class: 'deskmain',
  });

  if (state.layout === 'phone') {
    main.append(todaysRooms());
  } else {
    const grid = timelineGrid();
    gridNode = grid;
    const frame = el('div', { class: 'gridframe' }, [grid]);
    frameNode = frame;
    const columns: Node[] = [frame];
    if (state.layout === 'desk' || state.todayOpen) columns.push(todayPanel());
    main.append(
      el('div', { class: `deskcolumns${state.todayOpen ? ' overlay' : ''}` }, columns),
    );
  }

  const results = closeResults();
  if (results) main.append(el('div', { class: 'closeresults' }, [results]));
  main.append(tallyRail());

  return shell(extras, [
    el('div', { class: 'noticeline' }, [
      statusRegion(regionNames.deskNotices),
      statusRegion(regionNames.closeStatus),
    ]),
    main,
  ]);
}

/** Puts focus back on the grid's one tab stop and keeps the business date column in view. */
export function restoreDeskFocus(hadGridFocus: boolean): void {
  if (frameNode && gridNode) {
    const business = gridNode.querySelector<HTMLElement>('.headrow .daycol.business');
    if (business) {
      frameNode.scrollLeft = Math.max(0, business.offsetLeft - frameNode.clientWidth / 2);
    }
  }
  if (hadGridFocus && tabStop) tabStop.focus();
}

export function deskGridNode(): HTMLElement | null {
  return gridNode;
}
