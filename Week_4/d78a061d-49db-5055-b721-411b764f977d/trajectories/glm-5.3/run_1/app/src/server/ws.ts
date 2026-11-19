import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { contextFrom } from './context.js';
import { openConnection, closeConnection, heartbeat } from './presence.js';
import { attachSocket, detachSocket, resumeFor, publishPartyState } from './realtime.js';
import { partyForAccount, partyChannel } from './parties.js';
import { sessionState, snapshotJson, applyIntent, persistSession } from './world.js';
import { settleGraces, onMemberConnectionsChanged } from './world-conn.js';
import config from './config.js';
import { isEmote, type Emote } from '../shared/domain.js';
import type { Locale } from '../shared/domain.js';

const PING_INTERVAL_MS = 2000;
const PING_TIMEOUT_MS = 4000;

export function setupRealtime(server: import('node:http').Server): void {
  const wss = new WebSocketServer({ noServer: true });
  const lastPong = new Map<string, number>();

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://local');
    if (url.pathname !== '/api/realtime') {
      socket.destroy();
      return;
    }
    const origin = req.headers.origin;
    const appOrigin = config.publicUrl.replace(/\/$/, '');
    if (origin && origin !== appOrigin) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    void contextFrom(req).then((ctx) => {
      const accountId = ctx.account?.id;
      if (!accountId) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        void handleConnection(ws, accountId, ctx.locale);
      });
    });
  });

  async function handleConnection(ws: WebSocket, accountId: string, locale: Locale): Promise<void> {
    const connection = openConnection(accountId);
    const connectionId = crypto.randomUUID();
    const socket = {
      accountId,
      connection,
      send: (text: string) => {
        if (ws.readyState === ws.OPEN) ws.send(text);
      },
      followedStreams: new Set<string>([`me:${accountId}`, 'chat:lobby']),
      resumeSeq: new Map<string, number>(),
      locale: () => locale,
    };
    lastPong.set(connectionId, Date.now());
    attachSocket(socket);
    ws.on('pong', () => lastPong.set(connectionId, Date.now()));

    const party = await partyForAccount(accountId);
    if (party) {
      socket.followedStreams.add(`party:${party.id}`);
      socket.followedStreams.add(`chat:${partyChannel(party.id)}`);
      await publishPartyState(party.id);
    }

    const pingTimer = setInterval(() => {
      if (ws.readyState !== ws.OPEN) return;
      const pong = lastPong.get(connectionId) ?? 0;
      if (Date.now() - pong > PING_TIMEOUT_MS + PING_INTERVAL_MS) {
        // A silent connection counts as closed and is then closed (Connection loss rule).
        ws.terminate();
        return;
      }
      ws.ping();
    }, PING_INTERVAL_MS);

    const teardown = () => {
      clearInterval(pingTimer);
      lastPong.delete(connectionId);
      detachSocket(socket);
      closeConnection(connection);
    };

    ws.on('message', (raw) => {
      void (async () => {
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          return;
        }
        heartbeat(connection);
        const type = message.type;
        if (type === 'hello') {
          const resume = (message.resume ?? {}) as Record<string, number>;
          const currentParty = await partyForAccount(accountId);
          if (currentParty) {
            socket.followedStreams.add(`party:${currentParty.id}`);
            socket.followedStreams.add(`chat:${partyChannel(currentParty.id)}`);
            await publishPartyState(currentParty.id);
          }
          await resumeFor(socket, resume);
          const { deliverSnapshots } = await import('./ticker.js');
          await deliverSnapshots();
        } else if (type === 'heartbeat') {
          heartbeat(connection);
        } else if (type === 'join_session') {
          const sessionId = message.session_id;
          if (typeof sessionId !== 'string') return;
          const state = sessionState(sessionId);
          if (!state) {
            socket.send(JSON.stringify({ type: 'join_refused', session_id: sessionId, event: { kind: 'session_ended' } }));
            return;
          }
          const member = state.members.find((m) => m.account_id === accountId);
          if (!member) {
            socket.send(JSON.stringify({ type: 'join_refused', session_id: sessionId, event: { kind: 'not_a_member' } }));
            return;
          }
          if (state.status === 'complete') {
            socket.send(JSON.stringify({ type: 'join_refused', session_id: sessionId, event: { kind: 'session_complete', story_id: state.story_id, chapter: state.chapter } }));
            return;
          }
          const wasDropped = member.status === 'dropped';
          connection.joinedSessions.add(sessionId);
          socket.followedStreams.add(`session:${sessionId}`);
          socket.followedStreams.add(`chat:${`session-${sessionId}`}`);
          if (wasDropped) {
            await onMemberConnectionsChanged(sessionId, accountId);
          } else {
            member.status = 'connected';
            await persistSession(state);
            await publishPartyState(state.party_id ?? '');
          }
          socket.send(JSON.stringify({ type: 'joined', session_id: sessionId, tick: state.tick }));
          socket.send(JSON.stringify({ type: 'snapshot', session: snapshotJson(state) }));
          const { tickSoon } = await import('./ticker.js');
          tickSoon();
        } else if (type === 'intent') {
          const sessionId = message.session_id;
          const intentId = message.intent_id;
          const action = message.action;
          if (typeof sessionId !== 'string' || typeof intentId !== 'string' || typeof action !== 'string') return;
          const state = sessionState(sessionId);
          if (!state) return;
          const member = state.members.find((m) => m.account_id === accountId);
          if (!member) return;
          let emote: Emote | undefined;
          if (action === 'emote') {
            if (!isEmote(message.emote)) return;
            emote = message.emote;
          }
          const ack = await applyIntent(state, accountId, {
            intent_id: intentId,
            action: action as 'move_to' | 'swing' | 'emote',
            x: typeof message.x === 'number' ? message.x : undefined,
            z: typeof message.z === 'number' ? message.z : undefined,
            emote,
          });
          socket.send(JSON.stringify({ type: 'ack', ...ack }));
          await persistSession(state);
        }
      })();
    });

    ws.on('close', teardown);
    ws.on('error', teardown);
  }

  void wss;
  setInterval(() => {
    void settleGraces();
  }, 1000);
}
