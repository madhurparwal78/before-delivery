import { WebSocket, type RawData } from 'ws';
import { isJson } from '../shared/model/read.ts';
import type { DistributiveOmit, LiveClientMessage, LiveMessage, PresenceMember, Role } from '../shared/types.ts';
import { clock } from './clock.ts';
import { config } from './config.ts';
import { scheduler } from './scheduler.ts';

/** A live message before its sequence number is assigned. */
export type LiveEvent = DistributiveOmit<LiveMessage, 'seq'>;
export type LinkEvent = Extract<LiveEvent, { type: 'link' }>;

// The per-drawing log that replays what a reconnecting page missed. Cursor positions come in floods and only the latest matter, so
// they are kept apart and in fewer numbers: a long burst of pointer moves never pushes an applied group out of the log. Both are also
// bounded in bytes (a group can be a megabyte); a page that asks for more than the log still holds reloads the drawing instead.
const LOG_LIMIT = 5000;
const LOG_LIMIT_BYTES = 16 * 1024 * 1024;
const CURSOR_LOG_LIMIT = 500;
const CURSOR_LOG_LIMIT_BYTES = 1024 * 1024;
/** A socket that has this much unsent data stopped reading; it is dropped rather than buffered for without end. */
const SLOW_SOCKET_BYTES = 16 * 1024 * 1024;
const PING_MS = 20000;
const COLOURS = 8;

interface Client { socket: WebSocket; username: string; role: Role | null }

const isCursor = (message: LiveMessage): boolean => message.type === 'presence' && message.data.kind === 'cursor';

/** The newest messages sent, as the text that went over the wire, up to a count and a size. */
class MessageLog {
  private readonly entries: Array<{ seq: number; payload: string }> = [];
  private bytes = 0;

  constructor(private readonly maxMessages: number, private readonly maxBytes: number) {}

  add(seq: number, payload: string): void {
    this.entries.push({ seq, payload });
    this.bytes += payload.length;
    while (this.entries.length > 1 && (this.entries.length > this.maxMessages || this.bytes > this.maxBytes)) {
      this.bytes -= this.entries[0].payload.length;
      this.entries.shift();
    }
  }

  after(seq: number): Array<{ seq: number; payload: string }> {
    return this.entries.filter((entry) => entry.seq > seq);
  }
}

/**
 * One numbered stream of messages with the sockets listening to it. Every message goes to every socket, so `seq` counts up by one for
 * all of them. A socket joins when it says hello; the server then replays everything after `since`. A `since` ahead of the server
 * (the server restarted and numbering began again) replays the whole log.
 */
class Channel {
  protected readonly clients = new Set<Client>();
  private seq = 0;
  private readonly log = new MessageLog(LOG_LIMIT, LOG_LIMIT_BYTES);
  private readonly cursorLog = new MessageLog(CURSOR_LOG_LIMIT, CURSOR_LOG_LIMIT_BYTES);

  send(event: LiveEvent): void {
    const message: LiveMessage = { seq: ++this.seq, ...event };
    const payload = JSON.stringify(message);
    (isCursor(message) ? this.cursorLog : this.log).add(message.seq, payload);
    for (const client of this.clients) {
      if (client.socket.readyState !== WebSocket.OPEN) continue;
      if (client.socket.bufferedAmount > SLOW_SOCKET_BYTES) client.socket.terminate();
      else client.socket.send(payload);
    }
  }

  lastSeq(): number {
    return this.seq;
  }

  attach(client: Client): void {
    client.socket.on('message', (raw) => {
      const message = parseClientMessage(raw);
      if (!message) return;
      if (message.type === 'hello') {
        if (!this.clients.has(client)) this.subscribe(client, message.since);
      } else if (this.clients.has(client)) {
        this.relay(client, message);
      }
    });
    client.socket.on('close', () => {
      if (this.clients.delete(client)) this.left(client);
    });
    client.socket.on('error', () => client.socket.terminate());
  }

  people(): Array<{ username: string; role: Role | null }> {
    const seen = new Map<string, Role | null>();
    for (const client of this.clients) seen.set(client.username, client.role);
    return [...seen].map(([username, role]) => ({ username, role }));
  }

  closeAll(): void {
    for (const client of this.clients) client.socket.close(1001);
  }

  ping(): void {
    for (const client of this.clients) client.socket.ping();
  }

  protected joined(_client: Client): void {}
  protected left(_client: Client): void {}
  protected relay(_client: Client, _message: Extract<LiveClientMessage, { type: 'cursor' }>): void {}

  private subscribe(client: Client, since: number): void {
    this.joined(client);
    const from = since > this.seq ? 0 : since;
    const missed = [...this.log.after(from), ...this.cursorLog.after(from)].sort((a, b) => a.seq - b.seq);
    for (const { payload } of missed) client.socket.send(payload);
    this.clients.add(client);
  }
}

interface Person { colour: number; cancelRemoval: (() => void) | null }

/** A drawing's channel, with presence: who has it open, their colour index, and their relayed cursors. */
class DrawingRoom extends Channel {
  private readonly present = new Map<string, Person>();

  /** Gives the person the role the socket sees; null revokes it (every socket of theirs is closed and they leave the list at once). */
  setRole(username: string, role: Role | null): void {
    for (const client of this.clients) if (client.username === username) client.role = role;
    this.send({ type: 'role', data: { username, role } });
    if (role !== null) return;
    this.present.get(username)?.cancelRemoval?.();
    if (this.present.delete(username)) this.announceMembers();
    for (const client of this.clients) if (client.username === username) client.socket.close(1008);
  }

  protected override joined(client: Client): void {
    const person = this.present.get(client.username);
    if (person) {
      person.cancelRemoval?.();
      person.cancelRemoval = null;
      return;
    }
    this.present.set(client.username, { colour: this.lowestFreeColour(), cancelRemoval: null });
    this.announceMembers();
  }

  protected override left(client: Client): void {
    const person = this.present.get(client.username);
    if (!person || [...this.clients].some((other) => other.username === client.username)) return;
    person.cancelRemoval = scheduler.schedule(clock.now() + config.presenceTimeoutMs, () => {
      this.present.delete(client.username);
      this.announceMembers();
    });
  }

  protected override relay(client: Client, message: Extract<LiveClientMessage, { type: 'cursor' }>): void {
    const { type: _type, ...cursor } = message;
    this.send({ type: 'presence', data: { kind: 'cursor', username: client.username, ...cursor } });
  }

  private lowestFreeColour(): number {
    const used = new Set([...this.present.values()].map((person) => person.colour));
    for (let colour = 1; colour <= COLOURS; colour++) if (!used.has(colour)) return colour;
    return (this.present.size % COLOURS) + 1;
  }

  private announceMembers(): void {
    const members: PresenceMember[] = [...this.present].map(([username, person]) => ({ username, colour: person.colour }));
    this.send({ type: 'presence', data: { kind: 'members', members } });
  }
}

const isNumberOrNull = (value: unknown): value is number | null => value === null || typeof value === 'number';

function parseClientMessage(raw: RawData): LiveClientMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(raw.toString());
  } catch {
    return null;
  }
  if (!isJson(value)) return null;
  if (value.type === 'hello' && typeof value.since === 'number') return { type: 'hello', since: value.since };
  if (
    value.type === 'cursor' && isNumberOrNull(value.x) && isNumberOrNull(value.y) && Array.isArray(value.selection)
    && value.selection.every((handle) => typeof handle === 'string') && typeof value.zoom === 'number'
    && typeof value.pan_x === 'number' && typeof value.pan_y === 'number' && typeof value.width === 'number' && typeof value.height === 'number'
  ) {
    return {
      type: 'cursor', x: value.x, y: value.y, selection: value.selection, zoom: value.zoom,
      pan_x: value.pan_x, pan_y: value.pan_y, width: value.width, height: value.height,
    };
  }
  return null;
}

class Hub {
  private readonly rooms = new Map<string, DrawingRoom>();
  private readonly linkChannels = new Map<string, Channel>();
  private pinger: NodeJS.Timeout | null = null;

  /** Sends a message to every socket open on the drawing (it is logged for replay even when nobody is connected). */
  broadcast(drawingId: string, event: LiveEvent): void {
    this.room(drawingId).send(event);
  }

  /** The number of the last message of the drawing's channel (the server's numbering restarts at 1 when it restarts). */
  lastSeq(drawingId: string): number {
    return this.rooms.get(drawingId)?.lastSeq() ?? 0;
  }

  /** Connects an upgraded socket to the drawing's channel for a person who has `role` on it. */
  attachDrawing(drawingId: string, username: string, role: Role, socket: WebSocket): void {
    this.room(drawingId).attach({ socket, username, role });
  }

  /** Connects an upgraded socket to the channel of a view link. */
  attachLink(linkId: string, socket: WebSocket): void {
    this.linkChannel(linkId).attach({ socket, username: '', role: null });
  }

  sendToLink(linkId: string, event: LinkEvent): void {
    this.linkChannel(linkId).send(event);
  }

  /** Every person with a socket open on a drawing, with the role their sockets currently show. */
  connectedPeople(): Array<{ drawingId: string; username: string; role: Role | null }> {
    return [...this.rooms].flatMap(([drawingId, room]) => room.people().map((person) => ({ drawingId, ...person })));
  }

  setRole(drawingId: string, username: string, role: Role | null): void {
    this.room(drawingId).setRole(username, role);
  }

  start(): void {
    this.pinger = setInterval(() => {
      for (const channel of [...this.rooms.values(), ...this.linkChannels.values()]) channel.ping();
    }, PING_MS);
  }

  stop(): void {
    if (this.pinger) clearInterval(this.pinger);
    for (const channel of [...this.rooms.values(), ...this.linkChannels.values()]) channel.closeAll();
  }

  private room(drawingId: string): DrawingRoom {
    let room = this.rooms.get(drawingId);
    if (!room) {
      room = new DrawingRoom();
      this.rooms.set(drawingId, room);
    }
    return room;
  }

  private linkChannel(linkId: string): Channel {
    let channel = this.linkChannels.get(linkId);
    if (!channel) {
      channel = new Channel();
      this.linkChannels.set(linkId, channel);
    }
    return channel;
  }
}

export const hub = new Hub();
