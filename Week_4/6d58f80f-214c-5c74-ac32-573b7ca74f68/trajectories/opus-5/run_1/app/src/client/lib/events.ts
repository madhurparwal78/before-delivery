import type { ServerEvent } from '../../shared/types.js';
import { addNotice, announce, getState, setState } from './store.js';
import { STORAGE_BACK, STORAGE_BACK_RESUMED, STORAGE_OUTAGE } from '../../shared/copy.js';
import { resumeWaitingUploads, markUploadExpired } from './uploads.js';

type Handler = (event: ServerEvent) => void;

const handlers = new Set<Handler>();
let socket: WebSocket | null = null;
let reconnectTimer: number | null = null;

export const onServerEvent = (handler: Handler): (() => void) => {
  handlers.add(handler);
  return () => handlers.delete(handler);
};

const reconnectListeners = new Set<() => void>();

export const onReconnect = (handler: () => void): (() => void) => {
  reconnectListeners.add(handler);
  return () => reconnectListeners.delete(handler);
};

const applyGlobal = (event: ServerEvent): void => {
  switch (event.type) {
    case 'status': {
      const before = getState().status;
      setState({ status: event.data });
      if (before.storage === 'up' && event.data.storage === 'down') announce(STORAGE_OUTAGE);
      if (before.storage === 'down' && event.data.storage === 'up') {
        const waiting = getState().uploads.some((row) => row.state === 'waiting');
        announce(waiting ? STORAGE_BACK_RESUMED : STORAGE_BACK);
        void resumeWaitingUploads();
      }
      break;
    }
    case 'clock':
      setState({ clock: event.data });
      break;
    case 'storage':
      setState({ storage: event.data });
      break;
    case 'notice':
      addNotice(event.data);
      announce(event.data.text);
      break;
    case 'upload_expired':
      markUploadExpired(event.data.uploadId, event.data.name);
      break;
    default:
      break;
  }
};

export const connectEvents = (): void => {
  if (socket !== null) return;
  const url = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/api/events`;
  const next = new WebSocket(url);
  socket = next;
  next.addEventListener('message', (message) => {
    const event = JSON.parse(String(message.data)) as ServerEvent;
    applyGlobal(event);
    for (const handler of handlers) handler(event);
  });
  const retry = (): void => {
    socket = null;
    if (reconnectTimer !== null) return;
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      connectEvents();
      for (const listener of reconnectListeners) listener();
    }, 2_000);
  };
  next.addEventListener('close', retry);
  next.addEventListener('error', retry);
};

export const disconnectEvents = (): void => {
  socket?.close();
  socket = null;
};
