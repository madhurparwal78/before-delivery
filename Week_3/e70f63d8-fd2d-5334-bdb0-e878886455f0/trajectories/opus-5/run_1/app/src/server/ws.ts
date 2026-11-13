import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { config } from './config.js';
import { cookiesOf } from './http.js';
import { currentHolder, takePen } from './pen.js';
import {
  type UserRow,
  isScorer,
  matchByCode,
  matchById,
  userBySession,
  visibleTournament,
} from './store.js';
import { liveUp, penRenew, startLive } from './valkey.js';

interface Watcher {
  socket: WebSocket;
  user: UserRow | null;
  matchId: string | null;
  code: string | null;
  tournamentId: string | null;
  scoring: boolean;
  pen: string | null;
  renew: NodeJS.Timeout | null;
}

const watchers = new Set<Watcher>();
const server = new WebSocketServer({ noServer: true });

function send(watcher: Watcher, message: unknown): void {
  if (watcher.socket.readyState === 1) watcher.socket.send(JSON.stringify(message));
}

function sendRaw(watcher: Watcher, message: string): void {
  if (watcher.socket.readyState === 1) watcher.socket.send(message);
}

function relay(channel: string, message: string): void {
  if (channel.startsWith('match:')) {
    const matchId = channel.slice('match:'.length);
    const isLinkOff = message.includes('"link-off"');
    for (const watcher of watchers) {
      if (watcher.matchId !== matchId) continue;
      if (isLinkOff && !watcher.code) continue;
      sendRaw(watcher, message);
    }
    return;
  }
  if (channel.startsWith('tournament:')) {
    const tournamentId = channel.slice('tournament:'.length);
    for (const watcher of watchers) {
      if (watcher.tournamentId === tournamentId) sendRaw(watcher, message);
    }
  }
}

function scoringWatchers(matchId: string): Watcher[] {
  return [...watchers].filter((watcher) => watcher.scoring && watcher.matchId === matchId);
}

function announcePen(matchId: string, except: Watcher | null, holder: string | null): void {
  for (const watcher of scoringWatchers(matchId)) {
    if (watcher === except || watcher.pen) continue;
    send(watcher, { type: 'pen', pen: null, holder });
  }
}

async function askForPen(watcher: Watcher): Promise<void> {
  if (!watcher.matchId || !watcher.user) return;
  const granted = await takePen(watcher.matchId, watcher.user);
  if (granted) {
    watcher.pen = granted.pen;
    watcher.renew = setInterval(
      () => {
        void penRenew(watcher.matchId!, granted.value);
      },
      Math.max(100, Math.floor(config.penGraceMs / 4)),
    );
    send(watcher, { type: 'pen', pen: granted.pen, holder: watcher.user.display_name });
    announcePen(watcher.matchId, watcher, watcher.user.display_name);
    return;
  }
  const holder = await currentHolder(watcher.matchId);
  send(watcher, { type: 'pen', pen: null, holder: holder ? holder.name : null });
}

function releasePen(watcher: Watcher): void {
  if (watcher.renew) clearInterval(watcher.renew);
  watcher.renew = null;
  const matchId = watcher.matchId;
  const pen = watcher.pen;
  watcher.pen = null;
  if (!matchId || !pen) return;
  setTimeout(() => {
    void (async () => {
      const holder = await currentHolder(matchId);
      if (!holder || holder.pen === pen) announcePen(matchId, null, null);
    })();
  }, config.penGraceMs + 100);
}

async function handleMessage(watcher: Watcher, raw: string): Promise<void> {
  let message: { type?: string; code?: string; match?: string; tournament?: string };
  try {
    message = JSON.parse(raw) as typeof message;
  } catch {
    return;
  }
  const reject = (): void => {
    send(watcher, { type: 'error', code: 'NOT_FOUND' });
    watcher.socket.close();
  };

  if (message.type === 'watch' && message.code) {
    const match = await matchByCode(message.code);
    if (!match || !match.viewer_link) {
      reject();
      return;
    }
    watcher.matchId = match.id;
    watcher.code = message.code;
    if (!liveUp()) send(watcher, { type: 'live', status: 'paused' });
    return;
  }

  if (message.type === 'watch' && message.tournament) {
    if (!watcher.user || !(await visibleTournament(watcher.user.id, message.tournament))) {
      reject();
      return;
    }
    watcher.tournamentId = message.tournament;
    if (!liveUp()) send(watcher, { type: 'live', status: 'paused' });
    return;
  }

  if ((message.type === 'watch' || message.type === 'score') && message.match) {
    const match = await matchById(message.match);
    if (!match || !watcher.user || !(await isScorer(match.id, watcher.user.id))) {
      reject();
      return;
    }
    watcher.matchId = match.id;
    watcher.scoring = true;
    if (message.type === 'score') await askForPen(watcher);
    if (!liveUp()) send(watcher, { type: 'live', status: 'paused' });
    return;
  }

  if (message.type === 'take-pen' && message.match) {
    const match = await matchById(message.match);
    if (!match || !watcher.user || !(await isScorer(match.id, watcher.user.id))) {
      reject();
      return;
    }
    watcher.matchId = match.id;
    watcher.scoring = true;
    await askForPen(watcher);
  }
}

export function startSockets(): void {
  startLive(relay);
  let wasUp = liveUp();
  setInterval(() => {
    const up = liveUp();
    if (wasUp && !up) {
      for (const watcher of watchers) send(watcher, { type: 'live', status: 'paused' });
    }
    wasUp = up;
  }, 1000);

  server.on('connection', (socket: WebSocket, request: IncomingMessage) => {
    const watcher: Watcher = {
      socket,
      user: null,
      matchId: null,
      code: null,
      tournamentId: null,
      scoring: false,
      pen: null,
      renew: null,
    };
    watchers.add(watcher);
    const cookies = cookiesOf(request);
    void userBySession(cookies.oc_session ?? null).then((user) => {
      watcher.user = user;
    });
    socket.on('message', (data: Buffer) => {
      void (async () => {
        if (!watcher.user) {
          const cookie = cookies.oc_session ?? null;
          watcher.user = await userBySession(cookie);
        }
        await handleMessage(watcher, data.toString());
      })();
    });
    socket.on('close', () => {
      releasePen(watcher);
      watchers.delete(watcher);
    });
    socket.on('error', () => {
      socket.close();
    });
  });
}

export function handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (origin) {
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
    if (originHost !== host) {
      socket.destroy();
      return;
    }
  }
  server.handleUpgrade(request, socket, head, (socket_) => {
    server.emit('connection', socket_, request);
  });
}
