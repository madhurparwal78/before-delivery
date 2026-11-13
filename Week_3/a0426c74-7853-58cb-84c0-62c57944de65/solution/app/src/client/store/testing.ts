// Test support: a drawing server in miniature (the model engine behind fetch and a fake live socket) and the deps a DrawingStore needs from the page.
import { ApiError } from '../../shared/errors.ts';
import { documentCollections } from '../../shared/model/index.ts';
import { Harness } from '../../shared/model/testing.ts';
import type { DrawingSeed } from '../../shared/model/index.ts';
import type { OpInput } from '../../shared/model/testing.ts';
import type { DrawingDocument, LiveMessage, OperationGroup, OpsMessage, Role } from '../../shared/types.ts';
import { DrawingStore } from './drawingStore.ts';
import type { DrawingDeps } from './drawingStore.ts';
import type { LiveHandlers, LiveSocket } from './liveChannel.ts';

export const ME = 'asha';
export const OTHER = 'bram';
export const DRAWING_ID = 'd1';

type MessageData<T extends LiveMessage['type']> = Extract<LiveMessage, { type: T }>['data'];

class MemoryStorage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

interface Connection { handlers: LiveHandlers; sent: unknown[]; closed: boolean }

export class FakeServer {
  readonly harness: Harness;
  readonly connections: Connection[] = [];
  readonly posts: OperationGroup[] = [];
  role: Role = 'edit';
  /** when set, the next POST of ops answers this refusal */
  refuseNext: ApiError | null = null;
  private seq = 0;

  constructor(seed: DrawingSeed = {}) {
    this.harness = new Harness(seed);
  }

  document(): DrawingDocument {
    return {
      id: DRAWING_ID, name: 'Plot plan', folder_id: 'f1', role: this.role, revision: this.harness.state.revision, next_handle: this.harness.state.next_handle,
      seq: this.seq, view: null, ...documentCollections(this.harness.state), sheets: [],
    };
  }

  /** Delivers a live message to every open socket, numbered like the hub does. */
  broadcast<T extends LiveMessage['type']>(type: T, data: MessageData<T>): void {
    const message = { seq: ++this.seq, type, data } as LiveMessage;
    for (const connection of this.connections) if (!connection.closed) connection.handlers.message(JSON.stringify(message));
  }

  /** Another person's group, applied and broadcast. */
  remote(user: string, ops: readonly OpInput[], options: { base?: number; command?: string } = {}): OpsMessage {
    const outcome = this.harness.apply(user, ops, options);
    const data: OpsMessage = {
      username: user, group_id: `remote-${this.seq}`, command: options.command ?? 'EDIT', base_revision: options.base ?? outcome.state.revision - ops.length,
      revision: outcome.state.revision, ops: ops.map((op, i) => ({ ...op, op_id: `remote-op-${i}` }) as OpsMessage['ops'][number]), results: outcome.results, patch: outcome.patch,
    };
    this.broadcast('ops', data);
    return data;
  }

  private respond(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }

  fetch: typeof fetch = (input, init) => {
    const path = String(input);
    const method = init?.method ?? 'GET';
    if (method === 'GET' && path === `/api/drawings/${DRAWING_ID}`) return Promise.resolve(this.respond(this.document()));
    if (method === 'GET' && path.startsWith('/api/folders/')) return Promise.resolve(this.respond({ drawings: [] }));
    if (method === 'POST' && path === `/api/drawings/${DRAWING_ID}/ops`) return this.applyPosted(JSON.parse(String(init?.body)) as OperationGroup);
    throw new Error(`unexpected request ${method} ${path}`);
  };

  private async applyPosted(group: OperationGroup): Promise<Response> {
    await new Promise((resolve) => setImmediate(resolve));
    this.posts.push(group);
    const refusal = this.refuseNext;
    this.refuseNext = null;
    try {
      if (refusal) throw refusal;
      const outcome = this.harness.apply(ME, group.ops.map(({ op_id: _id, ...op }) => op), { base: group.base_revision, command: group.command });
      this.broadcast('ops', {
        username: ME, group_id: group.group_id, command: group.command, base_revision: group.base_revision, revision: outcome.state.revision,
        ops: group.ops, results: outcome.results, patch: outcome.patch,
      });
      return this.respond({ revision: outcome.state.revision, results: outcome.results });
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      return this.respond(error.toBody(), error.status);
    }
  }

  openSocket = (_path: string, handlers: LiveHandlers): LiveSocket => {
    const connection: Connection = { handlers, sent: [], closed: false };
    this.connections.push(connection);
    queueMicrotask(() => handlers.open());
    return {
      send: (data) => connection.sent.push(JSON.parse(data)),
      close: () => {
        connection.closed = true;
      },
    };
  };
}

interface Spy { announced: string[]; toasts: string[]; signedOut: number }

/** A store wired to `server`, and what it announced and toasted. */
export function openStore(server: FakeServer, options: { storage?: MemoryStorage } = {}): { store: DrawingStore; spy: Spy; storage: MemoryStorage } {
  const spy: Spy = { announced: [], toasts: [], signedOut: 0 };
  const storage = options.storage ?? new MemoryStorage();
  let counter = 0;
  const deps: DrawingDeps = {
    domMarginPx: 200, domCeiling: 500, username: ME, announce: (text) => spy.announced.push(text), toast: (text) => spy.toasts.push(text),
    signIn: () => { spy.signedOut += 1; }, fetch: (input, init) => server.fetch(input, init), openSocket: server.openSocket, storage, newId: () => `id${++counter}`,
  };
  return { store: new DrawingStore(DRAWING_ID, deps), spy, storage };
}

export { MemoryStorage };

/** Lets promises and microtasks run: responses, socket opens, queue sends. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setImmediate(resolve));
}
