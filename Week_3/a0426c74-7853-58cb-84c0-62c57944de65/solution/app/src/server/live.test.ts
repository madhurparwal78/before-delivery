import './testenv.ts';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, test } from 'node:test';
import { WebSocket, WebSocketServer } from 'ws';
import type { LiveClientMessage, LiveMessage } from '../shared/types.ts';
import { clock } from './clock.ts';
import { hub } from './live.ts';
import { scheduler } from './scheduler.ts';

let server: Server;
let sockets: WebSocketServer;
let url: string;

before(async () => {
  server = createServer();
  sockets = new WebSocketServer({ server });
  sockets.on('connection', (socket, req) => {
    const params = new URL(req.url ?? '/', 'http://localhost').searchParams;
    hub.attachDrawing(params.get('drawing') ?? '', params.get('user') ?? '', 'edit', socket);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address === 'object');
  url = `ws://127.0.0.1:${address.port}`;
});

after(() => {
  for (const socket of sockets.clients) socket.terminate();
  sockets.close();
  server.close();
});

class Client {
  readonly messages: LiveMessage[] = [];
  private readonly socket: WebSocket;
  private readonly opened: Promise<void>;

  constructor(drawing: string, user: string, since: number | null = 0) {
    this.socket = new WebSocket(`${url}?drawing=${drawing}&user=${user}`);
    this.socket.on('message', (raw) => this.messages.push(JSON.parse(raw.toString())));
    this.opened = new Promise((resolve) => this.socket.on('open', () => {
      if (since !== null) this.send({ type: 'hello', since });
      resolve();
    }));
  }

  send(message: LiveClientMessage): void {
    this.socket.send(JSON.stringify(message));
  }

  async settle(): Promise<void> {
    await this.opened;
    await new Promise((resolve) => setTimeout(resolve, 60));
  }

  async close(): Promise<void> {
    this.socket.close();
    await new Promise((resolve) => setTimeout(resolve, 60));
  }

  get seqs(): number[] {
    return this.messages.map((message) => message.seq);
  }

  members(): Array<{ username: string; colour: number }> {
    const last = this.messages.filter((message) => message.type === 'presence' && message.data.kind === 'members').at(-1);
    return last?.type === 'presence' && last.data.kind === 'members' ? last.data.members : [];
  }
}

const notice = (text: string) => ({ type: 'notice', data: { username: 'a', text } }) as const;

test('numbers messages consecutively per drawing and replays what a reconnecting page missed', async () => {
  const first = new Client('numbering', 'asha');
  await first.settle();
  hub.broadcast('numbering', notice('one'));
  hub.broadcast('numbering', notice('two'));
  await first.settle();
  assert.deepEqual(first.seqs, [1, 2, 3]);
  await first.close();
  hub.broadcast('numbering', notice('three'));
  hub.broadcast('numbering', notice('four'));
  const again = new Client('numbering', 'asha', 3);
  await again.settle();
  assert.deepEqual(again.messages.filter((message) => message.type === 'notice').map((message) => message.seq), [4, 5]);
  assert.deepEqual(again.seqs, [4, 5], 'a person who is still listed does not announce members again');
});

test('a page whose since is ahead of the server is replayed the whole log', async () => {
  hub.broadcast('restarted', notice('only'));
  const client = new Client('restarted', 'asha', 500);
  await client.settle();
  assert.deepEqual(client.seqs, [1, 2]);
});

test('nothing is sent before hello', async () => {
  const quiet = new Client('quiet', 'asha', null);
  await quiet.settle();
  hub.broadcast('quiet', notice('x'));
  await quiet.settle();
  assert.deepEqual(quiet.seqs, []);
});

test('people get the lowest free colour in join order and give it back after the presence timeout', async () => {
  const a = new Client('colours', 'asha');
  await a.settle();
  const b = new Client('colours', 'bram');
  await b.settle();
  assert.deepEqual(b.members(), [{ username: 'asha', colour: 1 }, { username: 'bram', colour: 2 }]);
  await a.close();
  assert.equal(b.members().length, 2, 'a closed socket stays listed until the timeout');
  clock.advance(15001);
  await scheduler.runDue();
  await b.settle();
  assert.deepEqual(b.members(), [{ username: 'bram', colour: 2 }]);
  const c = new Client('colours', 'cleo');
  await c.settle();
  assert.deepEqual(c.members(), [{ username: 'bram', colour: 2 }, { username: 'cleo', colour: 1 }]);
});

test('coming back before the timeout keeps the colour and the removal is cancelled', async () => {
  const a = new Client('return', 'asha');
  await a.settle();
  await a.close();
  const back = new Client('return', 'asha');
  await back.settle();
  clock.advance(20000);
  await scheduler.runDue();
  await back.settle();
  assert.deepEqual(back.members(), [{ username: 'asha', colour: 1 }]);
});

test('cursor messages are relayed to everyone with the sender named', async () => {
  const a = new Client('cursors', 'asha');
  const b = new Client('cursors', 'bram');
  await Promise.all([a.settle(), b.settle()]);
  a.send({ type: 'cursor', x: 5, y: 6, selection: ['L1'], zoom: 10, pan_x: 1, pan_y: 2, width: 800, height: 600 });
  await b.settle();
  const relayed = b.messages.find((message) => message.type === 'presence' && message.data.kind === 'cursor');
  assert.deepEqual(relayed?.type === 'presence' ? relayed.data : null, {
    kind: 'cursor', username: 'asha', x: 5, y: 6, selection: ['L1'], zoom: 10, pan_x: 1, pan_y: 2, width: 800, height: 600,
  });
});

test('revoking a role tells everyone, closes that person and frees their colour at once', async () => {
  const a = new Client('revoked', 'asha');
  const b = new Client('revoked', 'bram');
  await Promise.all([a.settle(), b.settle()]);
  assert.deepEqual(hub.connectedPeople().filter((person) => person.drawingId === 'revoked').map((person) => person.username), ['asha', 'bram']);
  hub.setRole('revoked', 'asha', null);
  await b.settle();
  assert.ok(b.messages.some((message) => message.type === 'role' && message.data.username === 'asha' && message.data.role === null));
  assert.deepEqual(b.members(), [{ username: 'bram', colour: 2 }]);
  assert.deepEqual(hub.connectedPeople().filter((person) => person.drawingId === 'revoked').map((person) => person.username), ['bram']);
});

test('the replay log is bounded in bytes: big messages push the oldest out, the newest always stays', async () => {
  const megabyte = 'x'.repeat(1024 * 1024);
  for (let i = 0; i < 40; i++) hub.broadcast('heavy', notice(megabyte));
  const client = new Client('heavy', 'asha', 0);
  await client.settle();
  await new Promise((resolve) => setTimeout(resolve, 400));
  const notices = client.messages.filter((message) => message.type === 'notice').map((message) => message.seq);
  assert.ok(notices.length >= 10 && notices.length <= 17, `kept ${notices.length} of 40`);
  assert.equal(notices.at(-1), 40);
  assert.deepEqual(notices, notices.map((_, i) => 40 - notices.length + 1 + i), 'what is kept is consecutive, newest last');
});
