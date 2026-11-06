import { api, ApiCallError } from './api.js';
import { copy } from './copy.js';
import { el, openDialog, type Dialog } from './dom.js';
import { currentFloor, loadFloor, startFloorWatch } from './floor.js';
import { announce } from './shell.js';
import { onStreamEvent } from './stream.js';
import { nameOf, state } from './store.js';
import type { Knock } from '../shared/types.js';

type Waiting = { knock: Knock; roomName: string };

const queue: Waiting[] = [];
let dialog: Dialog | null = null;
let showing: Knock | null = null;
let started = false;

function roomNameOf(roomId: string): string {
  return currentFloor()?.rooms.find((room) => room.id === roomId)?.name ?? '';
}

function insideRoom(roomId: string): boolean {
  return currentFloor()?.me.room_id === roomId;
}

function openNext(): void {
  if (dialog !== null) return;
  const next = queue.shift();
  if (next === undefined) return;
  if (!insideRoom(next.knock.room_id)) {
    openNext();
    return;
  }
  showing = next.knock;
  const knocker = nameOf(next.knock.person_id);
  dialog = openDialog({
    name: `Knock at ${next.roomName}`,
    build: (body, self) => {
      const letIn = el('button', { type: 'button', text: 'Let in' });
      const notNow = el('button', { type: 'button', text: 'Not now' });
      letIn.addEventListener('click', () => {
        void answer(next.knock, 'let_in', knocker, self);
      });
      notNow.addEventListener('click', () => {
        void answer(next.knock, 'not_now', knocker, self);
      });
      body.append(
        el('h2', { class: 'display', text: `Knock at ${next.roomName}` }),
        el('p', { text: copy.knockAtDoor(knocker) }),
        letIn,
        notNow,
      );
    },
    onClose: () => {
      dialog = null;
      showing = null;
      window.setTimeout(openNext, 0);
    },
  });
}

async function answer(
  knock: Knock,
  decision: 'let_in' | 'not_now',
  knocker: string,
  self: Dialog,
): Promise<void> {
  try {
    await api<Knock>('POST', `/api/knocks/${knock.id}/answer`, { body: { answer: decision } });
    announce(decision === 'let_in' ? copy.knockAnsweredLetIn(knocker) : copy.knockAnsweredNotNow(knocker));
  } catch (error) {
    if (error instanceof ApiCallError && error.code === 'knock_expired') announce(copy.knockHasExpired);
    else if (error instanceof ApiCallError && error.code === 'knock_answered') announce(copy.knockAlreadyAnswered);
  } finally {
    self.close();
    void loadFloor();
  }
}

/** Occupants answer knocks one at a time, on whichever module they are on. */
export function startKnockWatch(): void {
  if (started || state.person === null) return;
  started = true;
  startFloorWatch(state.person.id);
  onStreamEvent((event) => {
    if (event.name !== 'knock') return;
    const knock = event.data as unknown as Knock;
    if (knock.person_id === state.person?.id) return;
    if (knock.status === 'waiting') {
      if (!insideRoom(knock.room_id)) return;
      if (showing?.id === knock.id || queue.some((entry) => entry.knock.id === knock.id)) return;
      queue.push({ knock, roomName: roomNameOf(knock.room_id) });
      openNext();
      return;
    }
    const index = queue.findIndex((entry) => entry.knock.id === knock.id);
    if (index !== -1) queue.splice(index, 1);
    if (showing?.id === knock.id && dialog !== null) {
      announce(knock.status === 'expired' ? copy.knockHasExpired : copy.knockAlreadyAnswered);
      dialog.close();
    }
  });
}
