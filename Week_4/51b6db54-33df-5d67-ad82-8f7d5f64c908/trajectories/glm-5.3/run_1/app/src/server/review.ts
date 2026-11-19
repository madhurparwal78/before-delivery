import type { Express } from 'express';
import { q, one } from './db.js';
import { notFound, forbidden, conflict, fieldErrors } from './errors.js';
import { now } from './clock.js';
import { requireUser } from './http.js';
import { getSprite, getFrames, nextSeq, clearAllUndo, writeCel } from './sprites.js';
import { requireMember, requireOwner, publicUrl } from './projects.js';
import { queueMail } from './mail.js';

export function registerReviewRoutes(app: Express): void {
  // ---- comments ----
  app.get('/api/sprites/:id/comments', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const sprite = await getSprite(req.params.id);
      await requireMember(Number(sprite.project_id), user.id);
      const rows = await q<{ id: string; frame: number; x: number; y: number; text: string; state: string; author: string; mentions: unknown }>(
        `select c.id::text, c.frame, c.x, c.y, c.text, c.state, u.name as author,
         coalesce((select json_agg(json_build_object('name', mu.name, 'state', m.state))
           from comment_mentions m join users mu on mu.id = m.member_id where m.comment_id = c.id), '[]') as mentions
         from comments c join users u on u.id = c.author_id where c.sprite_id = $1 order by c.id asc`,
        [sprite.id]
      );
      res.json({ comments: rows.map((r) => ({ id: Number(r.id), frame: r.frame, x: r.x, y: r.y, text: r.text, state: r.state, author: r.author, mentions: r.mentions })) });
    } catch (e) { next(e); }
  });

  app.post('/api/sprites/:id/comments', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const sprite = await getSprite(req.params.id);
      await requireMember(Number(sprite.project_id), user.id);
      const body = req.body as Record<string, unknown>;
      const idemKey = req.headers['idempotency-key'] as string | undefined;
      const bodyForCompare = { frame: body['frame'], x: body['x'], y: body['y'], text: body['text'] };
      if (idemKey) {
        const prior = await one<{ id: string }>('select id::text from comments where sprite_id = $1 and idempotency_key = $2', [sprite.id, idemKey]);
        if (prior) {
          const row = await commentResponse(Number(prior.id));
          if (JSON.stringify({ frame: row.frame, x: row.x, y: row.y, text: row.text }) !== JSON.stringify(bodyForCompare)) {
            throw conflict('idempotency_conflict');
          }
          res.status(201).json(row);
          return;
        }
      }
      const text = String(body['text'] ?? '');
      const frame = Number(body['frame']);
      const x = Number(body['x']);
      const y = Number(body['y']);
      const errors: Record<string, string> = {};
      if (!text.trim()) errors['text'] = 'Write a comment first';
      if (text.length > 2000) errors['text'] = 'Use at most 2,000 characters';
      const frames = await getFrames(Number(sprite.id));
      if (!frames.some((f) => f.position === frame)) errors['frame'] = 'No such frame';
      if (!Number.isInteger(x) || x < 0 || x >= sprite.width) errors['x'] = 'Outside the sprite';
      if (!Number.isInteger(y) || y < 0 || y >= sprite.height) errors['y'] = 'Outside the sprite';
      if (Object.keys(errors).length) throw fieldErrors(errors);
      const inserted = await one<{ id: string }>(
        'insert into comments (sprite_id, author_id, frame, x, y, text, state, idempotency_key, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id::text',
        [sprite.id, user.id, frame, x, y, text, 'open', idemKey ?? null, await now()]
      );
      // mentions: longest project member names first, case-insensitive
      const members = await q<{ id: string; name: string; email: string }>(
        `select u.id::text, u.name, u.email from memberships m join users u on u.id = m.user_id where m.project_id = $1`,
        [sprite.project_id]
      );
      const sorted = [...members].sort((a, b) => b.name.length - a.name.length);
      const mentioned: { id: number; name: string }[] = [];
      let remaining = text;
      for (const m of sorted) {
        const re = new RegExp(`@${escapeRe(m.name)}`, 'i');
        if (re.test(remaining)) {
          mentioned.push({ id: Number(m.id), name: m.name });
          remaining = remaining.replace(re, '');
        }
      }
      for (const m of mentioned) {
        await q('insert into comment_mentions (comment_id, member_id, state) values ($1, $2, $3) on conflict do nothing',
          [inserted!.id, m.id, 'pending']);
        await queueMail(members.find((x) => Number(x.id) === m.id)!.email,
          `Mentioned on ${sprite.name}, frame ${frame}`,
          `From: ${user.name}\nComment: ${text}`);
        await q('update comment_mentions set state = $1 where comment_id = $2 and member_id = $3', ['delivered', inserted!.id, m.id]);
      }
      const seq = await nextSeq(Number(sprite.id), 'comment', user.id, { id: Number(inserted!.id) });
      const row = await commentResponse(Number(inserted!.id));
      res.status(201).json({ ...row, seq });
    } catch (e) { next(e); }
  });

  app.post('/api/comments/:id/resolve', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const row = await one<{ id: string; sprite_id: string; state: string }>(
        'select id::text, sprite_id::text, state from comments where id = $1', [req.params.id]
      );
      if (!row) throw notFound();
      await requireMember(Number((await getSprite(row.sprite_id)).project_id), user.id);
      if (row.state === 'resolved') throw conflict('comment_state', { message: 'Already resolved' });
      await q('update comments set state = $1 where id = $2', ['resolved', row.id]);
      res.json(await commentResponse(Number(row.id)));
    } catch (e) { next(e); }
  });

  app.post('/api/comments/:id/reopen', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const row = await one<{ id: string; sprite_id: string; state: string }>(
        'select id::text, sprite_id::text, state from comments where id = $1', [req.params.id]
      );
      if (!row) throw notFound();
      await requireMember(Number((await getSprite(row.sprite_id)).project_id), user.id);
      if (row.state === 'open') throw conflict('comment_state', { message: 'Already open' });
      await q('update comments set state = $1 where id = $2', ['open', row.id]);
      res.json(await commentResponse(Number(row.id)));
    } catch (e) { next(e); }
  });

  // ---- drafts ----
  app.get('/api/drafts/:key', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const row = await one<{ text: string; version: number }>(
        'select text, version from drafts where user_id = $1 and key = $2', [user.id, req.params.key]
      );
      res.json(row ?? { text: '', version: 0 });
    } catch (e) { next(e); }
  });

  app.put('/api/drafts/:key', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const body = req.body as Record<string, unknown>;
      const text = String(body['text'] ?? '');
      const version = Number(body['version']);
      const row = await one<{ text: string; version: number }>(
        'select text, version from drafts where user_id = $1 and key = $2', [user.id, req.params.key]
      );
      if (row && version !== row.version) {
        throw conflict('draft_newer', { current: { text: row.text, version: row.version } });
      }
      const newVersion = (row?.version ?? 0) + 1;
      await q(
        `insert into drafts (user_id, key, text, version) values ($1, $2, $3, $4)
         on conflict (user_id, key) do update set text = $3, version = $4`,
        [user.id, req.params.key, text, newVersion]
      );
      res.json({ text, version: newVersion });
    } catch (e) { next(e); }
  });

  // ---- snapshots ----
  app.get('/api/sprites/:id/snapshots', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const sprite = await getSprite(req.params.id);
      await requireMember(Number(sprite.project_id), user.id);
      const rows = await q<{ id: string; name: string; seq: number; at: string }>(
        'select id::text, name, seq, at from snapshots where sprite_id = $1 order by id desc', [sprite.id]
      );
      res.json({ snapshots: rows.map((r) => ({ id: Number(r.id), name: r.name, seq: r.seq, at: r.at })) });
    } catch (e) { next(e); }
  });

  app.post('/api/sprites/:id/snapshots', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const sprite = await getSprite(req.params.id);
      await requireOwner(Number(sprite.project_id), user.id);
      const name = String((req.body as Record<string, unknown>)['name'] ?? '').trim();
      if (!name) throw fieldErrors({ name: 'Write a snapshot name' });
      const taken = await one<{ id: string }>('select id::text from snapshots where sprite_id = $1 and name = $2', [sprite.id, name]);
      if (taken) throw fieldErrors({ name: 'That name is taken' });
      const state = await captureState(Number(sprite.id));
      const row = await one<{ id: string }>(
        'insert into snapshots (sprite_id, name, seq, state, at) values ($1, $2, $3, $4::jsonb, $5) returning id::text',
        [sprite.id, name, sprite.seq, JSON.stringify(state), await now()]
      );
      res.status(201).json({ id: Number(row!.id), name, seq: sprite.seq, at: await now() });
    } catch (e) { next(e); }
  });

  app.get('/api/sprites/:id/snapshots/compare', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const sprite = await getSprite(req.params.id);
      await requireMember(Number(sprite.project_id), user.id);
      const from = await one<{ id: string; state: SnapshotState }>('select id::text, state from snapshots where id = $1', [String(req.query.from)]);
      const to = await one<{ id: string; state: SnapshotState }>('select id::text, state from snapshots where id = $1', [String(req.query.to)]);
      if (!from || !to) throw notFound();
      const framesOut: { frame: number; changed: number; cells: { x: number; y: number; before: string; after: string }[] }[] = [];
      for (const [frame, a] of Object.entries(from.state.composites)) {
        const b = to.state.composites[frame];
        const cells: { x: number; y: number; before: string; after: string }[] = [];
        for (let y = 0; y < sprite.height; y++) {
          for (let x = 0; x < sprite.width; x++) {
            const before = a[(y * sprite.width + x) * 4];
            const after = b ? b[(y * sprite.width + x) * 4] : 0;
            if (before !== after) {
              cells.push({
                x, y,
                before: hexAt(a, x, y, sprite.width),
                after: b ? hexAt(b, x, y, sprite.width) : '00000000'
              });
            }
          }
        }
        if (cells.length) framesOut.push({ frame: Number(frame), changed: cells.length, cells });
      }
      for (const [frame, b] of Object.entries(to.state.composites)) {
        if (from.state.composites[frame]) continue;
        const cells: { x: number; y: number; before: string; after: string }[] = [];
        for (let y = 0; y < sprite.height; y++) {
          for (let x = 0; x < sprite.width; x++) {
            if (b[(y * sprite.width + x) * 4] !== 0) cells.push({ x, y, before: '00000000', after: hexAt(b, x, y, sprite.width) });
          }
        }
        if (cells.length) framesOut.push({ frame: Number(frame), changed: cells.length, cells });
      }
      framesOut.sort((a, b) => a.frame - b.frame);
      res.json({ frames: framesOut });
    } catch (e) { next(e); }
  });

  app.post('/api/snapshots/:id/restore', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const snap = await one<{ id: string; sprite_id: string; name: string; state: SnapshotState }>(
        'select id::text, sprite_id::text, name, state from snapshots where id = $1', [req.params.id]
      );
      if (!snap) throw notFound();
      const sprite = await getSprite(snap.sprite_id);
      await requireOwner(Number(sprite.project_id), user.id);
      const before = await captureState(Number(sprite.id));
      const beforeName = `Before restore ${snap.name}`;
      await q(
        'insert into snapshots (sprite_id, name, seq, state, at) values ($1, $2, $3, $4::jsonb, $5) on conflict (sprite_id, name) do nothing',
        [sprite.id, beforeName, sprite.seq, JSON.stringify(before), await now()]
      );
      await restoreState(Number(sprite.id), snap.state);
      await clearAllUndo(Number(sprite.id));
      await q('update layers set locked_by = null where sprite_id = $1', [sprite.id]);
      const seq = await nextSeq(Number(sprite.id), 'restore', user.id, { name: snap.name });
      res.json({ seq, before_snapshot: Number(snap.id) });
    } catch (e) { next(e); }
  });

  // ---- links ----
  app.get('/api/projects/:id/links', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const projectId = Number(req.params.id);
      await requireOwner(projectId, user.id);
      const rows = await q<{ id: string; sprite_id: string; label: string; token: string; state: string; expires_at: string | null }>(
        'select id::text, sprite_id::text, label, token, state, expires_at from share_links where sprite_id in (select id from sprites where project_id = $1) order by id desc',
        [projectId]
      );
      res.json({ links: rows.map((r) => ({
        id: Number(r.id), sprite: Number(r.sprite_id), label: r.label, token: r.token,
        url: `${publicUrl(req)}/s/${r.token}`, state: r.state, expires_at: r.expires_at
      })) });
    } catch (e) { next(e); }
  });

  app.post('/api/sprites/:id/links', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const sprite = await getSprite(req.params.id);
      await requireOwner(Number(sprite.project_id), user.id);
      const body = req.body as Record<string, unknown>;
      const label = String(body['label'] ?? '').trim() || 'Link';
      const expiresAt = body['expires_at'] === null ? null : String(body['expires_at'] ?? '');
      if (expiresAt !== null) {
        const nowIso = await now();
        if (!expiresAt || Date.parse(expiresAt) <= Date.parse(nowIso)) throw fieldErrors({ expires_at: 'Choose a time after now' });
      }
      const token = 'sl-' + Math.random().toString(36).slice(2, 14);
      const row = await one<{ id: string }>(
        'insert into share_links (sprite_id, label, token, state, expires_at, created_at) values ($1, $2, $3, $4, $5, $6) returning id::text',
        [sprite.id, label, token, 'active', expiresAt, await now()]
      );
      res.status(201).json({
        id: Number(row!.id), token, url: `${publicUrl(req)}/s/${token}`,
        label, state: 'active', expires_at: expiresAt
      });
    } catch (e) { next(e); }
  });

  app.delete('/api/links/:id', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const link = await one<{ id: string; sprite_id: string; state: string }>(
        'select id::text, sprite_id::text, state from share_links where id = $1', [req.params.id]
      );
      if (!link) throw notFound();
      const sprite = await getSprite(link.sprite_id);
      await requireOwner(Number(sprite.project_id), user.id);
      if (link.state === 'ended') throw conflict('link_ended');
      await q('update share_links set state = $1 where id = $2', ['ended', link.id]);
      res.json({ state: 'revoked' });
    } catch (e) { next(e); }
  });

  app.post('/api/links/:id/regenerate', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const link = await one<{ id: string; sprite_id: string; label: string; expires_at: string | null; state: string }>(
        'select id::text, sprite_id::text, label, expires_at, state from share_links where id = $1', [req.params.id]
      );
      if (!link) throw notFound();
      const sprite = await getSprite(link.sprite_id);
      await requireOwner(Number(sprite.project_id), user.id);
      if (link.state === 'ended') throw conflict('link_ended');
      const token = 'sl-' + Math.random().toString(36).slice(2, 14);
      await q('update share_links set token = $1 where id = $2', [token, link.id]);
      res.json({ id: Number(link.id), token, url: `${publicUrl(req)}/s/${token}`, state: 'active', expires_at: link.expires_at });
    } catch (e) { next(e); }
  });

  // ---- share (no sign-in) ----
  app.get('/api/share/:token', async (req, res, next) => {
    try {
      const link = await activeLink(req.params.token);
      const sprite = await getSprite(link.sprite_id);
      const frames = await getFrames(Number(sprite.id));
      const tags = await q<{ name: string; from_frame: number; to_frame: number; direction: string; repeat: number }>(
        'select name, from_frame, to_frame, direction, repeat from tags where sprite_id = $1 order by id asc', [sprite.id]
      );
      res.json({
        sprite: {
          name: sprite.name, width: sprite.width, height: sprite.height, seq: sprite.seq,
          frames: frames.map((f) => ({ number: f.position, duration_ms: f.duration_ms })),
          tags: tags.map((t) => ({ name: t.name, from: t.from_frame, to: t.to_frame, direction: t.direction, repeat: t.repeat }))
        },
        state: 'active'
      });
    } catch (e) { next(e); }
  });

  app.get('/api/share/:token/frames/:n/pixels', async (req, res, next) => {
    try {
      const link = await activeLink(req.params.token);
      const { frameComposite } = await import('./render.js');
      const { buf, w, h } = await frameComposite(Number(link.sprite_id), Number(req.params.n));
      const { bytesToHex } = await import('../shared/rules.js');
      const rows: string[][] = [];
      for (let y = 0; y < h; y++) {
        const row: string[] = [];
        for (let x = 0; x < w; x++) {
          const o = (y * w + x) * 4;
          row.push(bytesToHex(buf[o], buf[o + 1], buf[o + 2], buf[o + 3]));
        }
        rows.push(row);
      }
      res.json({ width: w, height: h, rows });
    } catch (e) { next(e); }
  });

  app.all('/api/share/:token/*', async (req, res, next) => {
    try {
      await activeLink(req.params.token);
      throw forbidden('This link is read only');
    } catch (e) { next(e); }
  });
}

async function activeLink(token: string): Promise<{ id: string; sprite_id: string; expires_at: string | null; state: string }> {
  const link = await one<{ id: string; sprite_id: string; expires_at: string | null; state: string }>(
    'select id::text, sprite_id::text, expires_at, state from share_links where token = $1', [token]
  );
  if (!link || link.state !== 'active') throw notFound();
  if (link.expires_at) {
    const nowIso = await now();
    if (Date.parse(link.expires_at) <= Date.parse(nowIso)) throw notFound();
  }
  return link;
}

export async function commentResponse(id: number): Promise<Record<string, unknown>> {
  const row = await one<{ id: string; frame: number; x: number; y: number; text: string; state: string; author: string; mentions: unknown }>(
    `select c.id::text, c.frame, c.x, c.y, c.text, c.state, u.name as author,
     coalesce((select json_agg(json_build_object('name', mu.name, 'state', m.state))
       from comment_mentions m join users mu on mu.id = m.member_id where m.comment_id = c.id), '[]') as mentions
     from comments c join users u on u.id = c.author_id where c.id = $1`,
    [id]
  );
  if (!row) throw notFound();
  return {
    id: Number(row.id), frame: row.frame, x: row.x, y: row.y, text: row.text,
    state: row.state, author: row.author, mentions: row.mentions
  };
}

function hexAt(buf: Uint8Array, x: number, y: number, w: number): string {
  const o = (y * w + x) * 4;
  const h = (n: number) => n.toString(16).padStart(2, '0');
  return h(buf[o]) + h(buf[o + 1]) + h(buf[o + 2]) + h(buf[o + 3]);
}

export interface SnapshotState {
  composites: Record<string, Uint8Array>;
  layers: unknown; frames: unknown; cels: unknown; palette: unknown; tags: unknown; tilesets: unknown; tilemaps: unknown;
}

export async function captureState(spriteId: number): Promise<SnapshotState> {
  const { frameComposite } = await import('./render.js');
  const sprite = await getSprite(spriteId);
  const frames = await getFrames(spriteId);
  const composites: Record<string, Uint8Array> = {};
  for (const f of frames) {
    const { buf } = await frameComposite(spriteId, f.position);
    composites[String(f.position)] = buf;
  }
  const layers = await q('select name, opacity, blend, visible, position from layers where sprite_id = $1 order by position', [spriteId]);
  const frameRows = await q('select position, duration_ms from frames where sprite_id = $1 order by position', [spriteId]);
  const cels = await q(
    `select f.position as frame, l.id::text as layer_id, c.rows, c.link_frame_id::text
     from cels c join frames f on f.id = c.frame_id join layers l on l.id = c.layer_id where f.sprite_id = $1`,
    [spriteId]
  );
  const paletteId = sprite.palette_id;
  const swatches = await q('select index, color, version, last_version from swatches where palette_id = $1', [paletteId]);
  const tags = await q('select name, from_frame, to_frame, direction, repeat from tags where sprite_id = $1', [spriteId]);
  const tilesets = await q('select id::text, name, tile_size, edge_table from tilesets where sprite_id = $1', [spriteId]);
  const tiles = await q('select tileset_id::text, num, rows from tiles where tileset_id in (select id from tilesets where sprite_id = $1)', [spriteId]);
  const tilemaps = await q('select id::text, tileset_id::text, name, width, height from tilemaps where sprite_id = $1', [spriteId]);
  const tilemapCells = await q('select tilemap_id::text, x, y, tile, flip_h, flip_v from tilemap_cells where tilemap_id in (select id from tilemaps where sprite_id = $1)', [spriteId]);
  return {
    composites, layers, frames: frameRows, cels, palette: swatches, tags,
    tilesets: { sets: tilesets, tiles }, tilemaps: { maps: tilemaps, cells: tilemapCells }
  };
}

async function restoreState(spriteId: number, state: SnapshotState): Promise<void> {
  const sprite = await getSprite(spriteId);
  // layers
  await q('delete from cels where layer_id in (select id from layers where sprite_id = $1)', [spriteId]);
  await q('delete from layers where sprite_id = $1', [spriteId]);
  for (const layer of (state.layers as { name: string; opacity: number; blend: string; visible: boolean; position: number }[])) {
    await q('insert into layers (sprite_id, name, opacity, blend, visible, locked_by, position) values ($1, $2, $3, $4, $5, null, $6)',
      [spriteId, layer.name, layer.opacity, layer.blend, layer.visible, layer.position]);
  }
  // frames
  const frames = await getFrames(spriteId);
  const newCount = (state.frames as { position: number; duration_ms: number }[]).length;
  if (frames.length > newCount) {
    await q('delete from frames where sprite_id = $1 and position > $2', [spriteId, newCount]);
  }
  for (const f of (state.frames as { position: number; duration_ms: number }[])) {
    const existing = await one<{ id: string }>('select id::text from frames where sprite_id = $1 and position = $2', [spriteId, f.position]);
    if (existing) {
      await q('update frames set duration_ms = $1 where id = $2', [f.duration_ms, existing.id]);
    } else {
      await q('insert into frames (sprite_id, position, duration_ms) values ($1, $2, $3)', [spriteId, f.position, f.duration_ms]);
    }
  }
  // cels
  const layerIdByName = new Map((await q<{ id: string; name: string }>('select id::text, name from layers where sprite_id = $1', [spriteId])).map((l) => [l.name, l.id]));
  const frameIdByPos = new Map((await getFrames(spriteId)).map((f) => [f.position, f.id]));
  for (const cel of (state.cels as { frame: number; layer_id: string; rows: number[][]; link_frame_id: string | null }[])) {
    const layerId = cel.layer_id;
    const frameId = frameIdByPos.get(cel.frame);
    if (!frameId) continue;
    await writeCel(Number(frameId), Number(layerId), cel.rows);
  }
  // palette
  await q('delete from swatches where palette_id = $1', [sprite.palette_id]);
  for (const s of (state.palette as { index: number; color: string; version: number; last_version: number }[])) {
    await q('insert into swatches (palette_id, index, color, version, last_version) values ($1, $2, $3, $4, $5)',
      [sprite.palette_id, s.index, s.color, s.version, s.last_version]);
  }
  // tags
  await q('delete from tags where sprite_id = $1', [spriteId]);
  for (const t of (state.tags as { name: string; from_frame: number; to_frame: number; direction: string; repeat: number }[])) {
    await q('insert into tags (sprite_id, name, from_frame, to_frame, direction, repeat) values ($1, $2, $3, $4, $5, $6)',
      [spriteId, t.name, t.from_frame, t.to_frame, t.direction, t.repeat]);
  }
  // tilesets and tilemaps
  await q('delete from tilemap_cells where tilemap_id in (select id from tilemaps where sprite_id = $1)', [spriteId]);
  await q('delete from tilemaps where sprite_id = $1', [spriteId]);
  await q('delete from tiles where tileset_id in (select id from tilesets where sprite_id = $1)', [spriteId]);
  await q('delete from tilesets where sprite_id = $1', [spriteId]);
  const sets = (state.tilesets as { sets: { id: string; name: string; tile_size: number; edge_table: number[] }[]; tiles: { tileset_id: string; num: number; rows: number[][] }[] });
  const setIdMap = new Map<string, string>();
  for (const set of sets.sets) {
    const row = await one<{ id: string }>(
      'insert into tilesets (sprite_id, name, tile_size, edge_table) values ($1, $2, $3, $4::jsonb) returning id::text',
      [spriteId, set.name, set.tile_size, JSON.stringify(set.edge_table)]
    );
    setIdMap.set(set.id, row!.id);
  }
  for (const tile of sets.tiles) {
    const newId = setIdMap.get(tile.tileset_id);
    if (!newId) continue;
    await q('insert into tiles (tileset_id, num, rows) values ($1, $2, $3::jsonb)', [newId, tile.num, JSON.stringify(tile.rows)]);
  }
  const maps = (state.tilemaps as { maps: { id: string; tileset_id: string; name: string; width: number; height: number }[]; cells: { tilemap_id: string; x: number; y: number; tile: number; flip_h: boolean; flip_v: boolean }[] });
  const mapIdMap = new Map<string, string>();
  for (const map of maps.maps) {
    const tsId = setIdMap.get(map.tileset_id);
    const row = await one<{ id: string }>(
      'insert into tilemaps (sprite_id, tileset_id, name, width, height) values ($1, $2, $3, $4, $5) returning id::text',
      [spriteId, tsId ?? map.tileset_id, map.name, map.width, map.height]
    );
    mapIdMap.set(map.id, row!.id);
  }
  for (const cell of maps.cells) {
    const mapId = mapIdMap.get(cell.tilemap_id);
    if (!mapId) continue;
    if (cell.tile === 0) continue;
    await q('insert into tilemap_cells (tilemap_id, x, y, tile, flip_h, flip_v) values ($1, $2, $3, $4, $5, $6)',
      [mapId, cell.x, cell.y, cell.tile, cell.flip_h, cell.flip_v]);
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
