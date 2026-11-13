interface ServerEvent {
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
let opening: number | undefined;

/** The live connection waits for the first paint to settle, so the page itself finishes loading first. */
const OPEN_DELAY_MILLISECONDS = 1_200;

const TYPES = [
  'reading.accepted',
  'kit.moved',
  'hold.changed',
  'layout.changed',
  'sheet.changed',
  'circuit.confirmed',
  'mask_job.changed',
];

async function headOf(): Promise<number | null> {
  try {
    const answer = await fetch('/api/events/head', { cache: 'no-store' });
    if (!answer.ok) return null;
    return ((await answer.json()) as { sequence: number }).sequence;
  } catch {
    return null;
  }
}

/** Resumes from the sequence the page had when it asked, so the wait loses nothing. */
function connect(path: string): void {
  const head = headOf();
  opening = window.setTimeout(() => {
    void head.then((sequence) => {
      if (opening === undefined) return;
      opening = undefined;
      source = new EventSource(sequence === null ? path : `${path}?lastEventId=${sequence}`);
      for (const type of TYPES) source.addEventListener(type, (frame) => deliver(frame as MessageEvent));
    });
  }, OPEN_DELAY_MILLISECONDS);
}

function disconnect(): void {
  window.clearTimeout(opening);
  opening = undefined;
  source?.close();
  source = null;
}

/** One stream per page, resuming by itself; EventSource carries Last-Event-ID. */
export function listen(path: string, listener: Listener): () => void {
  listeners.add(listener);
  if (source === null && opening === undefined) connect(path);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) disconnect();
  };
}

function deliver(frame: MessageEvent): void {
  const event = JSON.parse(frame.data as string) as ServerEvent;
  for (const listener of [...listeners]) listener(event);
}
