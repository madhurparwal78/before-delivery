import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

interface Client {
  socket: Duplex;
  sessionId: string | null;
  projectId: string | null;
  personId: string | null;
  personName: string | null;
  embed: boolean;
  alive: boolean;
}

const clients = new Set<Client>();

function frame(payload: string): Buffer {
  const data = Buffer.from(payload, 'utf8');
  const length = data.byteLength;
  if (length < 126) {
    return Buffer.concat([Buffer.from([0x81, length]), data]);
  }
  if (length < 65536) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
    return Buffer.concat([header, data]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(length), 2);
  return Buffer.concat([header, data]);
}

function sendTo(client: Client, message: unknown): void {
  if (!client.alive) return;
  try {
    client.socket.write(frame(JSON.stringify(message)));
  } catch {
    client.alive = false;
  }
}

export interface LiveHandlers {
  onSubscribe: (
    sessionId: string | null,
    projectId: string,
  ) => Promise<{ personId: string; personName: string } | null>;
}

let handlers: LiveHandlers | null = null;

export function setLiveHandlers(next: LiveHandlers): void {
  handlers = next;
}

function presenceFor(projectId: string): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const client of clients) {
    if (client.projectId !== projectId || client.embed || !client.personId) continue;
    seen.set(client.personId, client.personName ?? '');
  }
  return [...seen.entries()].map(([id, name]) => ({ id, name }));
}

function broadcastPresence(projectId: string): void {
  const people = presenceFor(projectId);
  for (const client of clients) {
    if (client.projectId !== projectId || client.embed) continue;
    sendTo(client, {
      type: 'presence',
      people: people.filter((person) => person.id !== client.personId),
    });
  }
}

export function broadcastChange(projectId: string, payload: Record<string, unknown>): void {
  for (const client of clients) {
    if (client.projectId !== projectId || client.embed) continue;
    sendTo(client, { type: 'changed', ...payload });
  }
}

export function broadcastLock(projectId: string, payload: Record<string, unknown>): void {
  for (const client of clients) {
    if (client.projectId !== projectId || client.embed) continue;
    sendTo(client, { type: 'lock', ...payload });
  }
}

export function broadcastVersion(projectId: string, number: number): void {
  for (const client of clients) {
    if (client.projectId !== projectId) continue;
    sendTo(client, { type: 'version', number });
  }
}

function decodeFrames(buffer: Buffer): { messages: string[]; rest: Buffer; closed: boolean } {
  const messages: string[] = [];
  let offset = 0;
  let closed = false;
  while (offset + 2 <= buffer.byteLength) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let cursor = offset + 2;
    if (length === 126) {
      if (cursor + 2 > buffer.byteLength) break;
      length = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (length === 127) {
      if (cursor + 8 > buffer.byteLength) break;
      length = Number(buffer.readBigUInt64BE(cursor));
      cursor += 8;
    }
    let maskKey: Buffer | null = null;
    if (masked) {
      if (cursor + 4 > buffer.byteLength) break;
      maskKey = buffer.slice(cursor, cursor + 4);
      cursor += 4;
    }
    if (cursor + length > buffer.byteLength) break;
    const payload = buffer.slice(cursor, cursor + length);
    if (maskKey) {
      for (let i = 0; i < payload.byteLength; i += 1) payload[i] ^= maskKey[i % 4];
    }
    cursor += length;
    offset = cursor;
    if (opcode === 0x08) closed = true;
    else if (opcode === 0x01) messages.push(payload.toString('utf8'));
  }
  return { messages, rest: buffer.slice(offset), closed };
}

export function handleUpgrade(request: IncomingMessage, socket: Duplex): void {
  const key = request.headers['sec-websocket-key'];
  if (typeof key !== 'string') {
    socket.destroy();
    return;
  }
  const accept = createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '\r\n',
    ].join('\r\n'),
  );
  const cookieHeader = request.headers.cookie ?? '';
  const sessionId =
    cookieHeader
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('hs_session='))
      ?.slice('hs_session='.length) ?? null;
  const client: Client = {
    socket,
    sessionId,
    projectId: null,
    personId: null,
    personName: null,
    embed: false,
    alive: true,
  };
  clients.add(client);
  let buffer = Buffer.alloc(0);

  socket.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    const decoded = decodeFrames(buffer);
    buffer = decoded.rest;
    for (const text of decoded.messages) {
      void handleMessage(client, text);
    }
    if (decoded.closed) {
      cleanup();
    }
  });
  const cleanup = (): void => {
    if (!client.alive) return;
    client.alive = false;
    clients.delete(client);
    if (client.projectId) broadcastPresence(client.projectId);
    socket.destroy();
  };
  socket.on('close', cleanup);
  socket.on('error', cleanup);
}

async function handleMessage(client: Client, text: string): Promise<void> {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return;
  }
  const type = parsed.type;
  if (type === 'subscribe' && typeof parsed.projectId === 'string') {
    const person = handlers ? await handlers.onSubscribe(client.sessionId, parsed.projectId) : null;
    if (!person) {
      sendTo(client, { type: 'denied' });
      return;
    }
    client.projectId = parsed.projectId;
    client.personId = person.personId;
    client.personName = person.personName;
    client.embed = false;
    sendTo(client, { type: 'subscribed', projectId: parsed.projectId });
    broadcastPresence(parsed.projectId);
    return;
  }
  if (type === 'embed-subscribe' && typeof parsed.projectId === 'string') {
    client.projectId = parsed.projectId;
    client.embed = true;
    sendTo(client, { type: 'subscribed', projectId: parsed.projectId });
  }
}
