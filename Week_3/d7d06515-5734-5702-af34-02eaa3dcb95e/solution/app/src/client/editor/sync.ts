// Live sync of one open drawing: the server-sent event stream and this tab's presence pings.
import type { DrawingEvent } from '../../shared/types.ts';
import { post, stream } from '../api.ts';

/** Presence is posted at most this often, whatever the input rate. */
const PRESENCE_MIN_MS = 2000;
const INPUT_EVENTS = ['keydown', 'pointerdown', 'pointermove'] as const;

interface SyncOptions {
  drawingId: string;
  tabId: string;
  onEvent: (event: DrawingEvent) => void;
  /** The stream came back after a drop: whatever was missed has to be fetched. */
  onReconnect: () => void;
}

export function startSync({ drawingId, tabId, onEvent, onReconnect }: SyncOptions): () => void {
    const stopStream = stream(
    `/api/drawings/${drawingId}/events?tab=${encodeURIComponent(tabId)}`,
    (event, data) => onEvent({ event, data } as DrawingEvent),
    {
      // The first open follows the page settling, so it fetches again like a reconnect does.
      onOpen: onReconnect,
    },
  );

  // Date.now() on purpose: the page clock may be wrong, but only the spacing of pings matters here.
  let lastPing = -Infinity;
  const ping = (): void => {
    const now = Date.now();
    if (now - lastPing < PRESENCE_MIN_MS) return;
    lastPing = now;
    void post(`/api/drawings/${drawingId}/presence`, { tab_id: tabId }).catch(() => undefined);
  };
  for (const name of INPUT_EVENTS) window.addEventListener(name, ping, { capture: true, passive: true });

  return () => {
    stopStream();
    for (const name of INPUT_EVENTS) window.removeEventListener(name, ping, { capture: true });
  };
}
