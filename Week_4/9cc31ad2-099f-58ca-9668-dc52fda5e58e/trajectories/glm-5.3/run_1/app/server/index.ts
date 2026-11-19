// Entry point: boot, schema, push hub, static client, listen.
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { loadConfig } from './config.js';
import { waitForDb } from './db.js';
import { ReplayStore } from './replayStore.js';
import { PushHub } from './push.js';
import { PlayerLocks } from './locks.js';
import { buildApp } from './app.js';
import type { Request, Response, NextFunction } from 'express';
import { ApiError } from './errors.js';
import { LobbyError } from './lobby.js';
import { ApiErrorLite } from './runs.js';

const cfg = loadConfig();
const db = await waitForDb(cfg.databaseUrl);
const store = new ReplayStore(cfg);
const hub = new PushHub();
const locks = new PlayerLocks();
const app = buildApp({ db, cfg, hub, store, locks });
// Static client files. Only the built client is served.
const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'client');
app.use(express.static(clientDir, { index: false, fallthrough: true }));

// Blocked paths must 404 even if a file exists.
const BLOCKED = /^\/(server|shared|node_modules|dist|package(-lock)?\.json|vite\.config\.ts|tsconfig|run\.json|\.env|THIRD_PARTY_NOTICES\.md)/;
app.use((req: Request, res: Response, next: NextFunction) => {
  if (BLOCKED.test(req.path)) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found.' } });
    return;
  }
  next();
});

// The SPA fallback for client routes, including the root.
app.get('/', serveIndex);
app.get('/*splat', (req: Request, res: Response) => {
  if (req.path.startsWith('/v1/') || req.path === '/health') {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found.' } });
    return;
  }
  serveIndex(req, res);
});

function serveIndex(_req: Request, res: Response): void {
  const index = path.join(clientDir, 'index.html');
  if (fs.existsSync(index)) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.sendFile(index);
  } else {
    res.status(404).send('Client build missing. Run npm run build.');
  }
}

// Error handling: one error shape.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ApiError) {
    res.status(err.status).json(err.body());
    return;
  }
  if (err instanceof LobbyError) {
    res.status(409).json({ error: { code: err.code, message: err.message } });
    return;
  }
  if (err instanceof ApiErrorLite) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  if (err instanceof SyntaxError) {
    res.status(422).json({ error: { code: 'VALIDATION_FAILED', message: 'Some fields need attention.' } });
    return;
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong.' } });
});

const server = http.createServer(app);
// Attach the player id to upgrade requests for the WebSocket.
server.on('upgrade', (req, socket, head) => {
  const cookie = req.headers.cookie ?? '';
  const m = /(?:^|;\s*)kerb_session=([^;]+)/.exec(cookie);
  if (!m) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  void import('./game.js').then(async ({ playerForSession }) => {
    const player = await playerForSession(db, m[1]);
    if (!player) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    (req as { playerId?: string }).playerId = player.playerId;
    (hub as unknown as { wssHandleUpgrade(req: unknown, socket: unknown, head: unknown): void }).wssHandleUpgrade(req, socket, head);
  });
});

// Lobby push wiring.
hub.onLobbyDisconnect = (playerId, lobbyId) => {
  void handleDisconnectSafe(playerId, lobbyId);
};
hub.onLobbySubscribe = async (playerId, lobbyId) => {
  // A reconnect inside the rejoin window.
  const { lobbyBody } = await import('./lobby.js');
  void lobbyBody;
  void playerId; void lobbyId;
};
hub.onKeyState = (playerId, lobbyId, keyState) => {
  setKeyStateSafe(lobbyId, playerId, keyState);
};

async function handleDisconnectSafe(playerId: string, lobbyId: string): Promise<void> {
  const { handleDisconnect } = await import('./lobby.js');
  await handleDisconnect(db, cfg, hub, lobbyId, playerId);
}

function setKeyStateSafe(lobbyId: string, playerId: string, keyState: unknown): void {
  void import('./lobby.js').then(({ setKeyState }) => {
    setKeyState(lobbyId, playerId, keyState);
  });
}

// Rejoin expiry sweeps are handled inside the lobby module.
const lobbyCleanup = setInterval(() => {
  // Keep the server aware of storage status for /v1/status.
  void store.ping();
}, 2000);
lobbyCleanup.unref?.();

server.listen(cfg.port, '0.0.0.0', () => {
  console.log(`Kerbline listening on 0.0.0.0:${cfg.port}`);
});

export {};
