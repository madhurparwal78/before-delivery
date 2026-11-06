import { api, ApiCallError } from '../api.js';
import { copy } from '../copy.js';
import { clear, el, setText } from '../dom.js';
import { currentFloor, loadFloor, onFloorChange, setFloor } from '../floor.js';
import { type Route } from '../router.js';
import { notFoundSheet, titleBlock, type ModuleContext, type ModuleHandle } from '../shell.js';
import { onStreamEvent } from '../stream.js';
import { state } from '../store.js';
import type { Floor, Knock, Room } from '../../shared/types.js';

export function officeModule(context: ModuleContext): ModuleHandle {
  let knockRoomId: string | null = null;
  const knockButtons = new Map<string, HTMLElement>();

  const rooms = el('div', { class: 'rows office-list' });
  context.list.append(rooms);

  const plan = el('div', { class: 'floor', role: 'region', 'aria-label': 'Office floor' });
  const knockStatus = el('p', {
    class: 'knock-status mono',
    role: 'status',
    'aria-live': 'polite',
    'aria-label': 'Knock status',
  });
  const knocks = el('div', { class: 'knock-buttons' });
  const sheet = el('div', { class: 'sheet office-sheet' }, [
    titleBlock('Office', 'Floor plan', ''),
    el('h1', { class: 'display', 'data-detail-title': 'true', text: 'Office floor' }),
    plan,
    knocks,
    knockStatus,
  ]);
  context.detail.append(sheet);

  function render(floor: Floor): void {
    clear(rooms);
    for (const room of floor.rooms) {
      rooms.append(
        el('div', { class: 'row office-row' }, [
          el('span', { class: 'cell title', text: room.name }),
          el('span', { class: 'cell mono', text: `${room.occupants.length} inside` }),
          el('span', { class: 'cell', text: room.kind === 'open' ? 'Door open' : 'Private' }),
        ]),
      );
    }
    renderPlan(floor);
    renderKnockButtons(floor);
  }

  function renderPlan(floor: Floor): void {
    clear(plan);
    const columns = Math.max(1, ...floor.rooms.map((room) => room.x + room.w - 1));
    const lines = Math.max(1, ...floor.rooms.map((room) => room.y + room.h - 1));
    plan.style.gridTemplateColumns = `repeat(${columns}, 1fr)`;
    plan.style.gridTemplateRows = `repeat(${lines}, 1fr)`;
    for (const room of floor.rooms) {
      const button = el('button', {
        type: 'button',
        class: `room ${room.kind}`,
        'aria-label': `${room.name}, ${room.occupants.length} inside`,
        'data-room': room.id,
      });
      button.style.gridColumn = `${room.x} / span ${room.w}`;
      button.style.gridRow = `${room.y} / span ${room.h}`;
      const marks = el('span', { class: 'marks' });
      for (const occupant of room.occupants) {
        const mine = occupant.person_id === state.person?.id;
        marks.append(
          el('span', {
            class: `mark ${occupant.status}${mine ? ' mine' : ''}`,
            title: occupant.name,
            'aria-hidden': 'true',
          }),
        );
      }
      button.append(
        el('span', { class: 'room-name', text: room.name }),
        el('span', { class: 'door', 'aria-hidden': 'true' }),
        marks,
      );
      button.addEventListener('click', () => {
        void activate(room);
      });
      plan.append(button);
    }
  }

  function renderKnockButtons(floor: Floor): void {
    clear(knocks);
    knockButtons.clear();
    for (const room of floor.rooms) {
      const occupied = room.occupants.length > 0;
      const inside = floor.me.room_id === room.id;
      if (room.kind !== 'private' || !occupied || inside) continue;
      const button = el('button', { type: 'button', text: `Knock on ${room.name}` });
      button.addEventListener('click', () => {
        void knock(room);
      });
      knocks.append(button);
      knockButtons.set(room.id, button);
    }
  }

  async function activate(room: Room): Promise<void> {
    const floor = currentFloor();
    const occupied = room.occupants.length > 0;
    const inside = floor?.me.room_id === room.id;
    if (room.kind === 'private' && occupied && !inside) {
      knockButtons.get(room.id)?.focus();
      return;
    }
    try {
      const next = await api<Floor>('POST', `/api/rooms/${room.id}/join`, { body: {} });
      setFloor(next);
    } catch (error) {
      if (error instanceof ApiCallError && error.code === 'knock_required') knockButtons.get(room.id)?.focus();
    }
  }

  async function knock(room: Room): Promise<void> {
    knockRoomId = room.id;
    setText(knockStatus, copy.knockWaiting);
    try {
      const result = await api<Knock>('POST', `/api/rooms/${room.id}/knocks`, { body: {} });
      showKnock(result);
    } catch {
      setText(knockStatus, '');
    }
  }

  function showKnock(result: Knock): void {
    knockRoomId = result.room_id;
    const labels: Record<Knock['status'], string> = {
      waiting: copy.knockWaiting,
      let_in: copy.knockLetIn,
      not_now: copy.knockNotNow,
      expired: copy.knockExpired,
    };
    setText(knockStatus, labels[result.status]);
    knockStatus.classList.toggle('expired', result.status === 'expired');
    if (result.status === 'let_in') void loadFloor();
  }

  const unsubscribeFloor = onFloorChange(render);
  const unsubscribeStream = onStreamEvent((event) => {
    if (event.name !== 'knock') return;
    const knockEvent = event.data as unknown as Knock;
    if (knockEvent.person_id !== state.person?.id) return;
    showKnock(knockEvent);
  });

  async function restoreKnock(): Promise<void> {
    const floor = currentFloor();
    if (floor === null) return;
    for (const room of floor.rooms) {
      if (room.kind !== 'private' || room.occupants.length === 0) continue;
      const mine = await api<Knock>('GET', `/api/rooms/${room.id}/knocks/mine`).catch(() => null);
      if (mine !== null && mine.status === 'waiting') {
        showKnock(mine);
        return;
      }
    }
    void knockRoomId;
  }

  return {
    id: 'office',
    firstPane: 'detail',
    route(route: Route) {
      if (!context.detail.contains(sheet)) {
        clear(context.detail);
        context.detail.append(sheet);
      }
      if (route.segments.length > 1) {
        clear(context.detail);
        context.detail.append(notFoundSheet());
        return;
      }
      const floor = currentFloor();
      if (floor !== null) render(floor);
      void loadFloor().then(restoreKnock);
    },
    destroy() {
      unsubscribeFloor();
      unsubscribeStream();
      clear(context.list);
      clear(context.detail);
    },
  };
}
