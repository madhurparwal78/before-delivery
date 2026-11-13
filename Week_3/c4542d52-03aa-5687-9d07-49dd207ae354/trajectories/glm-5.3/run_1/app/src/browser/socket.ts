// One live socket per page, server-to-client only. The page sends nothing over it.

export interface LiveEvent {
  seq: number | null;
  type: string;
  at: string;
  data: unknown;
}

type Listener = (event: LiveEvent) => void;

let socket: WebSocket | null = null;
let openListeners = new Set<(open: boolean) => void>();
let eventListeners = new Set<Listener>();
let lastSeq: number | null = null;
let isOpen = false;
let reconnectTimer: number | null = null;

export function socketOpen(): boolean {
  return isOpen;
}

export function onSocketOpen(fn: (open: boolean) => void): () => void {
  openListeners.add(fn);
  fn(isOpen);
  return () => openListeners.delete(fn);
}

export function onEvent(fn: Listener): () => void {
  eventListeners.add(fn);
  return () => eventListeners.delete(fn);
}

function connect(): void {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = lastSeq !== null
    ? `${proto}//${location.host}/api/live?since=${lastSeq}`
    : `${proto}//${location.host}/api/live`;
  try {
    socket = new WebSocket(url);
  } catch {
    scheduleReconnect();
    return;
  }
  socket.addEventListener('open', () => {
    isOpen = true;
    notifyOpen();
  });
  socket.addEventListener('message', (msg) => {
    try {
      const ev = JSON.parse(msg.data as string) as LiveEvent & { latest_seq?: number };
      if (ev.type === 'hello') {
        lastSeq = typeof ev.latest_seq === 'number' ? ev.latest_seq : lastSeq;
        return;
      }
      if (ev.type === 'clock') {
        for (const fn of eventListeners) fn(ev);
        return;
      }
      if (typeof ev.seq === 'number') {
        if (lastSeq !== null && ev.seq <= lastSeq) return; // apply each sequence once
        lastSeq = ev.seq;
      }
      for (const fn of eventListeners) fn(ev);
    } catch {
      // ignore malformed frames
    }
  });
  socket.addEventListener('close', () => {
    if (socketOpen()) {
      isOpen = false;
      notifyOpen();
    }
    scheduleReconnect();
  });
  socket.addEventListener('error', () => {
    // close handler follows
  });
}

function notifyOpen(): void {
  for (const fn of openListeners) fn(isOpen);
}

function scheduleReconnect(): void {
  if (reconnectTimer !== null) return;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, 2_000);
}

let started = false;

export function startSocket(): void {
  if (started) return;
  started = true;
  connect();
  // At least once every 5 seconds until open again.
  window.setInterval(() => {
    if (!isOpen && socket === null) connect();
  }, 5_000);
}

export function stopSocket(): void {
  if (socket) {
    socket.close();
    socket = null;
  }
  isOpen = false;
}

/** The server time from the latest clock event. */
let serverTime: string | null = null;

export function latestServerTime(): string | null {
  return serverTime;
}

export function setServerTime(t: string): void {
  serverTime = t;
}

/** A countdown `<D>d <HH>:<MM>:<SS>` from the latest server time. */
export function countdownTo(target: string | null, now: string): string {
  if (!target) return '0d 00:00:00';
  const ms = new Date(target).getTime() - new Date(now).getTime();
  if (ms <= 0) return '0d 00:00:00';
  const totalSec = Math.floor(ms / 1000);
  const d = Math.floor(totalSec / 86_400);
  const hh = Math.floor((totalSec % 86_400) / 3_600);
  const mm = Math.floor((totalSec % 3_600) / 60);
  const ss = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d}d ${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}
