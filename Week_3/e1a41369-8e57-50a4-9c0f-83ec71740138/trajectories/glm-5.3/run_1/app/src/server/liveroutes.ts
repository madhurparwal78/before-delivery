import express from 'express';
import type { Request, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config, requireAuth, q, q1, pool, live, toPlayer, toParty, toQuest, partyIdOf, allTasksBody, PUBLIC_DIR } from './kernel.js';

/** The SSE live stream: one per open screen, on the same session cookie. */
export function registerLiveRoute(app: express.Express): void {
  app.get('/api/live', requireAuth, async (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(':ok\n\n');
    const partyId = await partyIdOf(req.user!.id);
    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const remove = live.add(req.user!.id, partyId, send);
    // initial snapshot so a reconnecting screen is current
    send('player', await toPlayer(req.user!));
    send('tasks', await allTasksBody(req.user!.id));
    send('party', { party: partyId ? await toParty(partyId) : null });
    const invites = await q(`SELECT i.id, i.party_id, p.name, u.username AS leader
      FROM party_invites i JOIN parties p ON p.id=i.party_id JOIN users u ON u.id=p.leader_id
      WHERE i.user_id=$1 ORDER BY i.created_at`, [req.user!.id]);
    send('invite', { invites: invites.rows });
    if (partyId) {
      const party = await toParty(partyId);
      if (party?.questId) {
        send('quest', await toQuest(party.questId, req.user!.username));
      }
    }
    const heartbeat = setInterval(() => {
      try {
        res.write(':hb\n\n');
      } catch {
        clearInterval(heartbeat);
      }
    }, 25000);
    req.on('close', () => {
      clearInterval(heartbeat);
      remove();
    });
  });
}

const BLOCKED = new Set(['/package.json', '/run.json', '/.env', '/package-lock.json', '/tsconfig.json', '/vite.config.ts']);

/** Static serving: only the built SPA and the API, never source or config. */
export function registerStatic(app: express.Express): void {
  app.use((req, res, next) => {
    const p = req.path.replace(/\/+$/, '') || '/';
    if (BLOCKED.has(p) || p.startsWith('/src/') || p.startsWith('/dist/') || p.startsWith('/.') || p.endsWith('.map')) {
      res.status(404).send('Not found');
      return;
    }
    next();
  });
  app.use(express.static(PUBLIC_DIR, { index: 'index.html', fallthrough: true }));
  const indexHtml = path.join(PUBLIC_DIR, 'index.html');
  app.get(/.*/, (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      next();
      return;
    }
    if (fs.existsSync(indexHtml)) {
      res.sendFile(indexHtml);
      return;
    }
    res.status(503).send('App not built');
  });
}
