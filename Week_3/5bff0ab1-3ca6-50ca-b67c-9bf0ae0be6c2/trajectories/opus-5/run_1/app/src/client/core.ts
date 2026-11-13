import { STATUS_MIN_MS } from '../shared/strings.js';
import type { FinishId, HubId, ModelId } from '../shared/catalogue.js';
import type { LiveReading, User } from '../shared/types.js';

export interface ApiFailure {
  status: number;
  code: string;
  message: string;
}

export class ApiError extends Error {
  readonly failure: ApiFailure;
  constructor(failure: ApiFailure) {
    super(failure.message);
    this.name = 'ApiError';
    this.failure = failure;
  }
}

type Listener<T> = (value: T) => void;

export class Signal<T> {
  private readonly listeners = new Set<Listener<T>>();

  on(listener: Listener<T>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(value: T): void {
    for (const listener of [...this.listeners]) listener(value);
  }
}

export const sessionEnded = new Signal<void>();
export const identityChanged = new Signal<User | null>();
export const liveArrived = new Signal<LiveReading>();
export const mineChanged = new Signal<void>();
export const readFailed = new Signal<void>();

let currentUser: User | null = null;
let signedOutByServer = false;

export function user(): User | null {
  return currentUser;
}

export function setUser(next: User | null, announcePrompt: boolean): void {
  const before = currentUser?.id ?? null;
  currentUser = next;
  if ((next?.id ?? null) !== before) {
    identityChanged.emit(next);
    noteDrawnReset();
    reopenStream();
  }
  if (announcePrompt) sessionEnded.emit();
}

async function send(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<{ status: number; data: unknown }> {
  const init: RequestInit = { method, cache: 'no-store', credentials: 'same-origin' };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const response = await fetch(path, init);
  const text = await response.text();
  const data: unknown = text.length > 0 ? JSON.parse(text) : null;
  if (!response.ok) {
    const failure = (data as { error?: ApiFailure } | null)?.error ?? {
      status: response.status,
      code: 'not_found',
      message: '',
    };
    const full: ApiFailure = {
      status: response.status,
      code: failure.code,
      message: failure.message,
    };
    if (response.status === 401) {
      const hadUser = currentUser !== null;
      currentUser = null;
      if (hadUser && full.code === 'session_ended') {
        signedOutByServer = true;
        sessionEnded.emit();
      } else {
        identityChanged.emit(null);
      }
    }
    throw new ApiError(full);
  }
  return { status: response.status, data };
}

export async function apiGet<T>(path: string): Promise<T> {
  const { data } = await send('GET', path);
  return data as T;
}

export async function apiPost<T>(
  path: string,
  body?: unknown,
): Promise<{ status: number; data: T }> {
  const { status, data } = await send('POST', path, body);
  return { status, data: data as T };
}

export function sessionWasEnded(): boolean {
  return signedOutByServer;
}

export function clearSessionFlag(): void {
  signedOutByServer = false;
}

/* ---------- status region ---------- */

type Priority = 'session' | 'lock' | 'stale' | 'price' | 'other';
const ORDER: Priority[] = ['session', 'lock', 'stale', 'price', 'other'];

interface Pending {
  text: string;
  priority: Priority;
  arrived: number;
}

let pending: Pending[] = [];
let flushQueued = false;
const showQueue: string[] = [];
let showing = false;
let arrivalCounter = 0;

function region(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-status]');
}

export function announce(text: string, priority: Priority = 'other'): void {
  pending.push({ text, priority, arrived: (arrivalCounter += 1) });
  if (flushQueued) return;
  flushQueued = true;
  setTimeout(() => {
    flushQueued = false;
    const batch = pending;
    pending = [];
    batch.sort((a, b) => {
      const byPriority = ORDER.indexOf(a.priority) - ORDER.indexOf(b.priority);
      return byPriority !== 0 ? byPriority : a.arrived - b.arrived;
    });
    for (const entry of batch) showQueue.push(entry.text);
    void drain();
  }, 0);
}

export function clearStatus(): void {
  const element = region();
  if (element) element.textContent = '';
}

async function drain(): Promise<void> {
  if (showing) return;
  showing = true;
  while (showQueue.length > 0) {
    const text = showQueue.shift() as string;
    const element = region();
    if (element) {
      if (element.textContent === text) {
        element.textContent = '';
        await frame();
      }
      element.textContent = text;
    }
    await wait(STATUS_MIN_MS);
  }
  showing = false;
}

function wait(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

function frame(): Promise<void> {
  return new Promise((done) => requestAnimationFrame(() => done()));
}

/* ---------- dialogs ---------- */

export interface DialogHandle {
  element: HTMLElement;
  close(): void;
}

const stack: { handle: DialogHandle; opener: HTMLElement | null }[] = [];

export function openDialog(options: {
  label: string;
  build: (panel: HTMLElement, handle: DialogHandle) => void;
  onClose?: () => void;
}): DialogHandle {
  const layer = document.querySelector<HTMLElement>('[data-dialogs]');
  const opener = document.activeElement as HTMLElement | null;
  const element = document.createElement('div');
  element.className = 'dialog';
  element.setAttribute('role', 'dialog');
  element.setAttribute('aria-modal', 'true');
  element.setAttribute('aria-label', options.label);
  const panel = document.createElement('div');
  panel.className = 'dialog-panel';
  element.append(panel);
  const handle: DialogHandle = {
    element,
    close() {
      const index = stack.findIndex((entry) => entry.handle === handle);
      if (index >= 0) stack.splice(index, 1);
      element.remove();
      options.onClose?.();
      if (opener && document.contains(opener)) opener.focus();
    },
  };
  options.build(panel, handle);
  element.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      handle.close();
      return;
    }
    if (event.key === 'Tab') trapTab(event, panel);
  });
  layer?.append(element);
  stack.push({ handle, opener });
  focusFirst(panel);
  return handle;
}

export function dialogByLabel(label: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.dialog[aria-label="${label}"]`);
}

function focusables(panel: HTMLElement): HTMLElement[] {
  return [
    ...panel.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((element) => !element.hasAttribute('disabled'));
}

function focusFirst(panel: HTMLElement): void {
  focusables(panel)[0]?.focus();
}

function trapTab(event: KeyboardEvent, panel: HTMLElement): void {
  const items = focusables(panel);
  if (items.length === 0) return;
  const first = items[0] as HTMLElement;
  const last = items[items.length - 1] as HTMLElement;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/* ---------- live feed ---------- */

export interface Selection {
  hub: HubId;
  model: ModelId;
  finish: FinishId;
}

let selection: Selection = { hub: 'pune', model: 'megh-349', finish: 'monsoon-slate' };
let source: EventSource | null = null;
let lastMessageAt = Date.now();
let pollTimer: number | null = null;
let silenceTimer: number | null = null;
let selectionToken = 0;
let drawnSeq = -1;
let drawnToken = -1;

export function currentSelection(): Selection {
  return selection;
}

export function setSelection(next: Selection): void {
  if (
    next.hub === selection.hub &&
    next.model === selection.model &&
    next.finish === selection.finish
  ) {
    return;
  }
  selection = next;
  selectionToken += 1;
  reopenStream();
  void readNow();
}

function streamUrl(): string {
  return `/api/live?hub=${selection.hub}&model=${selection.model}&finish=${selection.finish}`;
}

export function reopenStream(): void {
  if (source) {
    source.close();
    source = null;
  }
  openStream();
}

function noteMessage(): void {
  lastMessageAt = Date.now();
}

function takeReading(reading: LiveReading, token: number): void {
  if (
    reading.hub !== selection.hub ||
    reading.model !== selection.model ||
    reading.finish !== selection.finish
  ) {
    return;
  }
  if (token !== selectionToken) return;
  if (token === drawnToken && reading.seq <= drawnSeq) return;
  drawnToken = token;
  drawnSeq = reading.seq;
  liveArrived.emit(reading);
}

export function noteDrawnReset(): void {
  drawnSeq = -1;
  drawnToken = -1;
  selectionToken += 1;
}

function openStream(): void {
  const token = selectionToken;
  const stream = new EventSource(streamUrl());
  source = stream;
  noteMessage();
  stream.addEventListener('live', (event) => {
    noteMessage();
    takeReading(JSON.parse((event as MessageEvent<string>).data) as LiveReading, token);
  });
  stream.addEventListener('ping', () => noteMessage());
  stream.addEventListener('mine', () => {
    noteMessage();
    mineChanged.emit();
  });
  stream.addEventListener('session', (event) => {
    noteMessage();
    const data = JSON.parse((event as MessageEvent<string>).data) as { state: string };
    currentUser = null;
    noteDrawnReset();
    if (data.state === 'ended') {
      signedOutByServer = true;
      sessionEnded.emit();
    } else {
      identityChanged.emit(null);
    }
  });
  stream.onerror = () => {
    stream.close();
    if (source === stream) source = null;
    startPolling();
    window.setTimeout(() => {
      if (!source) openStream();
    }, 3_000);
  };
  stream.onopen = () => {
    noteMessage();
    stopPolling();
  };
  startSilenceWatch();
}

function startSilenceWatch(): void {
  if (silenceTimer !== null) return;
  silenceTimer = window.setInterval(() => {
    if (Date.now() - lastMessageAt > 35_000) {
      noteMessage();
      reopenStream();
    }
  }, 5_000);
}

function startPolling(): void {
  if (pollTimer !== null) return;
  void readNow();
  pollTimer = window.setInterval(() => {
    void readNow();
  }, 5_000);
}

function stopPolling(): void {
  if (pollTimer === null) return;
  window.clearInterval(pollTimer);
  pollTimer = null;
}

export async function readNow(): Promise<void> {
  const token = selectionToken;
  try {
    const reading = await apiGet<LiveReading>(
      `/api/live/now?hub=${selection.hub}&model=${selection.model}&finish=${selection.finish}`,
    );
    takeReading(reading, token);
  } catch {
    readFailed.emit();
  }
}

export function startLive(initial: Selection, firstReading: LiveReading | null): void {
  selection = initial;
  if (firstReading) {
    drawnToken = selectionToken;
    drawnSeq = firstReading.seq;
    liveArrived.emit(firstReading);
  }
  openStream();
}

/* ---------- identity polling, for other tabs ---------- */

export function startIdentityWatch(): void {
  window.setInterval(() => {
    void (async () => {
      try {
        const reply = await apiGet<{ user: User }>('/api/me');
        if ((currentUser?.id ?? null) !== reply.user.id) {
          currentUser = reply.user;
          identityChanged.emit(reply.user);
          noteDrawnReset();
          reopenStream();
        }
      } catch (error) {
        if (error instanceof ApiError && error.failure.status === 401 && currentUser !== null) {
          currentUser = null;
          identityChanged.emit(null);
          noteDrawnReset();
          reopenStream();
        }
      }
    })();
  }, 1_500);
}
