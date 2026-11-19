import { heartbeat } from "./api";
import { deviceId } from "./state";

export interface LiveEvent {
  type: string;
  device_id: string | null;
  device_name: string | null;
  [key: string]: unknown;
}

type Listener = (event: LiveEvent) => void;

const listeners = new Set<Listener>();
let source: EventSource | null = null;

/// Every change the server broadcasts arrives over the same-origin stream.
export function startLive(): void {
  connect();
  void heartbeat(deviceId());
  window.setInterval(() => void heartbeat(deviceId()), 5000);
}

function connect(): void {
  source = new EventSource("/api/events");
  source.onmessage = (message) => {
    let event: LiveEvent;
    try {
      event = JSON.parse(message.data) as LiveEvent;
    } catch {
      return;
    }
    for (const listener of [...listeners]) listener(event);
  };
  source.onerror = () => {
    source?.close();
    window.setTimeout(connect, 1000);
  };
}

export function onLive(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function fromOtherDevice(event: LiveEvent): boolean {
  return event.device_id !== null && event.device_id !== deviceId();
}
