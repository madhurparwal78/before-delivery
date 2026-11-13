export type LiveHandler = (data: unknown) => void;

const names = [
  'presence',
  'placement',
  'node',
  'room',
  'lock',
  'version',
  'session',
  'solve',
  'hint',
  'tester',
  'live',
  'restore',
] as const;

export class LiveStream {
  private source: EventSource | null = null;
  private readonly handlers = new Map<string, Set<LiveHandler>>();

  constructor(private readonly path: string) {
    this.open();
  }

  on(event: (typeof names)[number], handler: LiveHandler): void {
    const set = this.handlers.get(event) ?? new Set();
    set.add(handler);
    this.handlers.set(event, set);
  }

  private open(): void {
    const source = new EventSource(this.path, { withCredentials: true });
    this.source = source;
    for (const name of names) {
      source.addEventListener(name, (event) => {
        const payload = JSON.parse((event as MessageEvent<string>).data) as unknown;
        for (const handler of this.handlers.get(name) ?? []) handler(payload);
      });
    }
    source.addEventListener('error', () => {
      if (source.readyState === EventSource.CLOSED) {
        window.setTimeout(() => this.open(), 2000);
      }
    });
  }

  close(): void {
    this.source?.close();
    this.source = null;
  }
}
