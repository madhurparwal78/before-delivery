import { announce, api, errorOf, pick } from './dom';
import { openDialog } from './dialogs';
import { copy, announce as announceCopy } from '../server/domain/copy';
import { screenData } from './navigate';

interface Waiting {
  key: string;
  meter: number;
  value: string;
  unit: string;
  savedAt: number;
  keepMine?: boolean;
}

const STORE = 'fioWaitingReadings';

function visitId(): string {
  const held = screenData().visitId;
  return typeof held === 'string' ? held : '';
}

function read(): Waiting[] {
  try {
    const held = window.localStorage.getItem(`${STORE}:${visitId()}`);
    return held ? (JSON.parse(held) as Waiting[]) : [];
  } catch {
    return [];
  }
}

function write(waiting: Waiting[]): void {
  try {
    window.localStorage.setItem(`${STORE}:${visitId()}`, JSON.stringify(waiting));
  } catch {
    /* a device with no storage keeps them in this page only */
  }
}

function waitingCount(): number {
  return read().length;
}

let sending = false;
let offline = false;

/** Offline, Sending or All readings sent, in the published wording. */
export function showWaitingLine(): void {
  const line = pick('[data-part="waiting-line"]');
  if (!line) return;
  const count = waitingCount();
  if (count === 0) line.textContent = copy.allSent;
  else if (offline) line.textContent = copy.offlineWaiting(count);
  else line.textContent = copy.sendingWaiting(count);
}

function newKey(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** The device saves each reading first and then tries to send it. */
export function addReading(meter: number, value: string, unit: string): void {
  const waiting = read();
  waiting.push({ key: newKey(), meter, value, unit, savedAt: Date.now() });
  write(waiting);
  showWaitingLine();
  void sendWaiting();
}

function drop(key: string): void {
  write(read().filter((entry) => entry.key !== key));
  showWaitingLine();
}

function replaceKey(key: string, keepMine: boolean): void {
  const waiting = read().map((entry) =>
    entry.key === key ? { ...entry, key: newKey(), keepMine } : entry,
  );
  write(waiting);
}

let heldLower: Waiting | null = null;

export function keepMine(): void {
  if (!heldLower) return;
  replaceKey(heldLower.key, true);
  heldLower = null;
  void sendWaiting();
}

export function keepRecorded(): void {
  if (!heldLower) return;
  drop(heldLower.key);
  heldLower = null;
  void sendWaiting();
}

/** Every refresh tries the waiting readings in the order taken. */
export async function sendWaiting(): Promise<void> {
  if (sending) return;
  sending = true;
  try {
    for (const entry of read()) {
      if (heldLower && heldLower.key === entry.key) continue;
      const secondsAgo = Math.max(0, Math.round((Date.now() - entry.savedAt) / 1000));
      let answer;
      try {
        answer = await api(
          'POST',
          `/api/visits/${visitId()}/readings`,
          {
            meter: entry.meter,
            value: entry.value,
            unit: entry.unit,
            secondsAgo,
            ...(entry.keepMine ? { keepMine: true } : {}),
          },
          { 'Request-Key': entry.key },
        );
      } catch {
        offline = true;
        showWaitingLine();
        return;
      }
      offline = false;
      if (answer.status === 201 || answer.status === 200) {
        drop(entry.key);
        announce(announceCopy.readingRecorded(entry.meter));
        continue;
      }
      const failure = errorOf(answer);
      if (answer.status === 422) {
        drop(entry.key);
        if (failure) announce(failure.message);
        continue;
      }
      if (answer.status === 409 && failure && failure.code === 'lower_reading') {
        heldLower = entry;
        const dialog = pick<HTMLElement>('#lower-reading');
        if (dialog) {
          const text = pick('[data-part="lower-reading-text"]', dialog);
          if (text) text.textContent = failure.message;
          dialog.setAttribute('aria-label', failure.message);
          openDialog(dialog, pick<HTMLElement>('[data-action="record-reading"]'));
        }
        continue;
      }
      if (answer.status >= 500 || answer.status === 429) {
        showWaitingLine();
        return;
      }
      drop(entry.key);
      if (failure) announce(failure.message);
    }
  } finally {
    sending = false;
    showWaitingLine();
  }
}

export function refuseSignOutWhileWaiting(): boolean {
  const count = waitingCount();
  if (count === 0) return false;
  announce(copy.signOutWaiting(count));
  return true;
}
