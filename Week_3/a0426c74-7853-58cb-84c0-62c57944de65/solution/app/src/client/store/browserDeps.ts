import { config } from '../config.ts';
import { leaveForSignIn } from '../api.ts';
import { announce, pushToast } from '../ui/index.ts';
import type { DrawingDeps } from './drawingStore.ts';
import type { SceneEnv } from './sceneStore.ts';
import type { LiveHandlers, LiveSocket } from './liveChannel.ts';

/** A 128-bit random id: op ids, group ids. (`crypto.randomUUID` is missing outside secure contexts, `getRandomValues` is not.) */
export function newId(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** A WebSocket to `path` on this origin, reporting to `handlers`. */
export function openSocket(path: string, handlers: LiveHandlers): LiveSocket {
  const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${path}`);
  socket.onopen = () => handlers.open();
  socket.onmessage = (event: MessageEvent<string>) => handlers.message(event.data);
  socket.onclose = () => handlers.close();
  return socket;
}

/** The settings a scene store takes from the page: the DOM margin and ceiling and the announcements. */
export function browserSceneEnv(): SceneEnv {
  return { domMarginPx: config.domMarginPx, domCeiling: config.domCeiling, announce };
}

/** What the live drawing store takes from the page for `username`. */
export function browserDrawingDeps(username: string): DrawingDeps {
  return {
    ...browserSceneEnv(),
    username,
    toast: pushToast,
    signIn: leaveForSignIn,
    fetch: (input, init) => fetch(input, { credentials: 'same-origin', ...init }),
    openSocket,
    storage: localStorage,
    newId,
  };
}
