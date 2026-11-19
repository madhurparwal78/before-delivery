// WebSockets: push only. Each frame is projected per viewer, so chat text
// reaches only its recipients and a blocked person's real name never appears.
import http from 'http';
import { WebSocketServer, type WebSocket } from 'ws';
import { personIdFromCookie } from './app';
import { query } from './db';
import {
  addMeSocket,
  addRoomSocket,
  allStates,
  clearPendingDrop,
  getSession,
  isBlockedBetween,
  isMember,
  markOnline,
  personSockets,
  recordPendingDrop,
  removeMeSocket,
  removeRoomSocket,
  type PersonState,
} from './live';
import { valkey } from './providers';
import { projectPeople } from './projection';
import { getPerson } from './live';
import { config } from './config';

export function setupWebsockets(server: http.Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const origin = req.headers.origin;
    if (origin && req.headers.host) {
      let originHost = '';
      try {
        originHost = new URL(origin).host;
      } catch {
        originHost = '';
      }
      if (originHost !== req.headers.host) {
        socket.destroy();
        return;
      }
    }
    const personId = personIdFromCookie(req);
    if (!personId) {
      socket.destroy();
      return;
    }
    const url = req.url ?? '';
    const sessionMatch = /^\/ws\/sessions\/([^/]+)$/.exec(url);
    if (sessionMatch) {
      void (async () => {
        const sessionId = sessionMatch[1];
        const session = await getSession(sessionId);
        const member = session ? await isMember(sessionId, personId) : false;
        if (!session || session.status !== 'open' || !member) {
          socket.destroy();
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
          handleRoomSocket(ws, sessionId, personId);
        });
      })();
      return;
    }
    if (url === '/ws/me') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        handleMeSocket(ws, personId);
      });
      return;
    }
    socket.destroy();
  });

  // One subscription per session channel, per instance. Events crossing
  // instances arrive through Valkey; frames go out projected per viewer.
  const channelListeners = new Map<string, (msg: string) => void>();

  async function ensureChannel(sessionId: string): Promise<void> {
    if (channelListeners.has(sessionId)) return;
    const listener = (msg: string): void => {
      try {
        const event = JSON.parse(msg) as Record<string, unknown>;
        void pushToSession(sessionId, event);
      } catch {
        // ignore malformed frames
      }
    };
    channelListeners.set(sessionId, listener);
    await valkey.subscribe(`session:${sessionId}:events`, listener).catch(() => {});
  }

  async function pushToSession(sessionId: string, event: Record<string, unknown>): Promise<void> {
    const session = await getSession(sessionId);
    if (!session) return;
    const states = await allStates(sessionId).catch(() => new Map<string, PersonState>());
    for (const handle of roomSocketsOf(sessionId)) {
      const viewer = await getPerson(handle.personId);
      if (!viewer) continue;
      const projected = await projectEvent(event, handle.personId, viewer.hide_above, sessionId, session.host_id, states);
      if (projected) handle.send(JSON.stringify(projected));
    }
  }

  function roomSocketsOf(sessionId: string): { personId: string; send: (p: string) => void }[] {
    return sessionSocketList(sessionId);
  }

  async function projectEvent(
    event: Record<string, unknown>,
    viewerId: string,
    hideAbove: string | null,
    sessionId: string,
    hostId: string,
    states: Map<string, PersonState>
  ): Promise<Record<string, unknown> | null> {
    const type = event.type as string;
    const fromId = event.personId as string | undefined;
    if (type === 'chat') {
      const toIds = (event.toIds as string[]) ?? [];
      if (!toIds.includes(viewerId) && event.fromId !== viewerId) return null;
      const sender = event.fromId as string;
      if (sender !== viewerId) {
        if (await isBlockedBetween(viewerId, sender)) return null;
      }
      const fromName = await projectedChatName(viewerId, sender, event.fromName as string);
      return { type: 'chat', id: event.id, fromId: sender, fromName, text: event.text, sentAt: event.at };
    }
    if (type === 'moved' || type === 'arrived') {
      const personId = (event.personId as string) ?? fromId;
      if (!personId) return null;
      const blocked = personId !== viewerId ? await isBlockedBetween(viewerId, personId) : false;
      const st = states.get(personId);
      const name = blocked ? 'Someone' : (st?.name ?? (event.name as string) ?? 'Someone');
      return {
        type,
        personId,
        name,
        x: event.x ?? st?.x,
        y: event.y ?? st?.y,
        facing: event.facing ?? st?.facing,
        seated: event.seated ?? st?.seated ?? false,
        avatar: await avatarStateForViewer(viewerId, personId, hideAbove, states),
      };
    }
    if (type === 'left' || type === 'removed-by-vote' || type === 'moderator-removed') {
      const personId = event.personId as string;
      const blocked = personId !== viewerId ? await isBlockedBetween(viewerId, personId) : false;
      return { type, personId, name: blocked ? 'Someone' : (event.name as string) };
    }
    if (type === 'host-changed') {
      const personId = event.personId as string;
      const blocked = personId !== viewerId ? await isBlockedBetween(viewerId, personId) : false;
      return { type, personId, name: blocked ? 'Someone' : (event.name as string) };
    }
    if (type === 'vote-opened' || type === 'vote-failed' || type === 'ended') {
      return { type, voteId: event.voteId, targetId: event.targetId };
    }
    return event;
  }

  async function projectedChatName(viewerId: string, senderId: string, realName: string): Promise<string> {
    if (viewerId === senderId) return realName;
    const blocked = await isBlockedBetween(viewerId, senderId);
    return blocked ? 'Someone' : realName;
  }

  async function avatarStateForViewer(viewerId: string, personId: string, hideAbove: string | null, states: Map<string, PersonState>): Promise<'shown' | 'hidden' | 'fallback'> {
    const me = await getPerson(personId);
    const targetAvatar = me?.avatar_id ?? states.get(personId)?.avatarId ?? null;
    const blocked = personId !== viewerId ? await isBlockedBetween(viewerId, personId) : false;
    let rank: string | null = null;
    if (targetAvatar) {
      const rows = await query<{ rank: string }>(
        'SELECT v.rank FROM assets a JOIN versions v ON v.asset_id = a.id AND v.version = a.current_version WHERE a.id = $1',
        [targetAvatar]
      );
      rank = rows[0]?.rank ?? null;
    }
    const { avatarStateFor } = await import('./projection');
    return avatarStateFor({
      isSelf: personId === viewerId,
      blockedBetween: blocked,
      targetHasAvatar: !!targetAvatar,
      targetAvatarRank: rank,
      hideAbove,
    });
  }

  function handleRoomSocket(ws: WebSocket, sessionId: string, personId: string): void {
    const send = (payload: string): void => {
      if (ws.readyState === 1) ws.send(payload);
    };
    addRoomSocket(sessionId, personId, send);
    clearPendingDrop(sessionId, personId);
    void markOnline(personId);
    void ensureChannel(sessionId);
    // Send the current mirror straight away so the page never waits.
    void (async () => {
      const session = await getSession(sessionId);
      if (!session) return;
      const viewer = await getPerson(personId);
      if (!viewer) return;
      const states = await allStates(sessionId).catch(() => new Map<string, PersonState>());
      const people = await projectPeople(sessionId, session.host_id, states, personId, viewer.hide_above).catch(() => []);
      send(JSON.stringify({ type: 'mirror', people }));
    })();
    ws.on('close', () => {
      removeRoomSocket(sessionId, personId, send);
      const remaining = personSockets(sessionId, personId);
      if (remaining.length === 0) {
        recordPendingDrop(sessionId, personId, '', 0);
      }
    });
    ws.on('message', () => {
      // push only; commands never travel over WebSockets
    });
  }

  function handleMeSocket(ws: WebSocket, personId: string): void {
    const send = (payload: string): void => {
      if (ws.readyState === 1) ws.send(payload);
    };
    addMeSocket(personId, send);
    void markOnline(personId);
    ws.on('close', () => {
      removeMeSocket(personId, send);
    });
    ws.on('message', () => {
      // push only
    });
  }

  function sessionSocketList(sessionId: string): { personId: string; send: (p: string) => void }[] {
    // Imported lazily to avoid a cycle at module init.
    const handles = require('./live') as {
      sessionSockets: (id: string) => { personId: string; send: (p: string) => void }[];
    };
    return handles.sessionSockets(sessionId);
  }
  void config;
}
