export interface ServerEvent {
  readonly type: string;
  readonly aggregate: string;
  readonly aggregateId: string;
  readonly sequence: number;
  readonly at: string;
  readonly data: Record<string, unknown>;
}

type Listener = (event: ServerEvent) => void;

const listeners = new Set<Listener>();
let source: EventSource | null = null;

/** One stream per page, resuming by itself; EventSource carries Last-Event-ID. */
export function listen(path: string, listener: Listener): () => void {
  listeners.add(listener);
  if (source === null || source.url.endsWith(path) === false) {
    source?.close();
    source = new EventSource(path);
    source.addEventListener('message', (frame) => deliver(frame as MessageEvent));
    for (const type of [
      'reading.accepted',
      'kit.moved',
      'hold.changed',
      'layout.changed',
      'sheet.changed',
      'circuit.confirmed',
      'mask_job.changed',
    ]) {
      source.addEventListener(type, (frame) => deliver(frame as MessageEvent));
    }
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      source?.close();
      source = null;
    }
  };
}

function deliver(frame: MessageEvent): void {
  const event = JSON.parse(frame.data as string) as ServerEvent;
  for (const listener of [...listeners]) listener(event);
}
