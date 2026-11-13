import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ClientMessage } from '../../shared/types.js';
import { userForSession } from '../services/accounts.js';
import { memberIds, partyIdOf } from '../services/parties.js';
import { announcePresence } from '../services/presence.js';
import { runnerFor } from '../services/matchrunner.js';
import { hub } from './hub.js';

const CLOSE_UNAUTHENTICATED = 4401;
const CLOSE_BAD_ORIGIN = 4403;

function cookieValue(header: string | undefined, name: string): string | null {
  if (header === undefined) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

export function sameOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (origin === undefined) return true;
  if (host === undefined) return false;
  return origin === `http://${host}` || origin === `https://${host}`;
}

function parse(raw: string): ClientMessage | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    return value as ClientMessage;
  } catch {
    return null;
  }
}

async function handleMessage(socket: WebSocket, userId: number, message: ClientMessage) {
  switch (message.type) {
    case 'heartbeat': {
      hub.heartbeat(userId);
      await announcePresence([userId]);
      return;
    }
    case 'input': {
      const runner = runnerFor(message.matchId);
      if (runner === null) {
        hub.sendToSocket(socket, { type: 'input_rejected', tick: message.tick, reason: 'invalid' });
        return;
      }
      const rejection = runner.handleInput(userId, message);
      if (rejection !== null) {
        hub.sendToSocket(socket, {
          type: 'input_rejected',
          tick: message.tick,
          reason: rejection,
        });
      }
      return;
    }
    case 'voice_state': {
      hub.setVoice(userId, {
        inVoice: message.inVoice === true,
        muted: message.muted === true,
        speaking: message.speaking === true,
      });
      const party = await memberIds(await partyIdOf(userId));
      const state = hub.voiceOf(userId);
      hub.broadcast(party, {
        type: 'voice_state',
        userId,
        inVoice: state.inVoice,
        muted: state.muted,
        speaking: state.speaking,
      });
      if (message.inVoice) {
        for (const member of party) {
          if (member === userId || !hub.inVoice(member)) continue;
          const other = hub.voiceOf(member);
          hub.sendToSocket(socket, {
            type: 'voice_state',
            userId: member,
            inVoice: other.inVoice,
            muted: other.muted,
            speaking: other.speaking,
          });
        }
      }
      return;
    }
    case 'voice_signal': {
      const party = await memberIds(await partyIdOf(userId));
      const target = Number(message.to);
      if (!party.includes(target) || !hub.inVoice(userId) || !hub.inVoice(target)) {
        hub.sendToSocket(socket, { type: 'error', code: 'not_in_voice' });
        return;
      }
      hub.send(target, { type: 'voice_signal', from: userId, data: message.data });
      return;
    }
  }
}

async function announceVoiceLeft(userId: number): Promise<void> {
  const party = await memberIds(await partyIdOf(userId));
  hub.broadcast(party, {
    type: 'voice_state',
    userId,
    inVoice: false,
    muted: false,
    speaking: false,
  });
}

export function attachWebSocket(server: Server): void {
  const sockets = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(request, socket, head, (ws) => {
      void openConnection(ws, request);
    });
  });
}

async function openConnection(ws: WebSocket, request: IncomingMessage): Promise<void> {
  const origin = request.headers.origin;
  if (!sameOrigin(typeof origin === 'string' ? origin : undefined, request.headers.host)) {
    ws.close(CLOSE_BAD_ORIGIN);
    return;
  }
  const token = cookieValue(request.headers.cookie, 'pc_session');
  const user = token === null ? null : await userForSession(token);
  if (user === null) {
    ws.close(CLOSE_UNAUTHENTICATED);
    return;
  }
  hub.add(ws, user.id);
  await announcePresence([user.id]);
  ws.on('message', (raw: Buffer) => {
    const message = parse(raw.toString('utf8'));
    if (message === null) {
      hub.sendToSocket(ws, { type: 'error', code: 'invalid_message' });
      return;
    }
    void handleMessage(ws, user.id, message);
  });
  ws.on('close', () => {
    const wasInVoice = hub.inVoice(user.id);
    hub.remove(ws);
    void announcePresence([user.id]);
    if (wasInVoice && !hub.inVoice(user.id)) void announceVoiceLeft(user.id);
  });
}
