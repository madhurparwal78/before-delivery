import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import sharp from 'sharp';
import { ApiError } from '../domain/errors.js';
import { MESSAGES } from '../domain/copy.js';
import { toInstantString, cphToday, marketTimeWords, CPH } from '../domain/dates.js';
import { zonedAt } from '../domain/dates.js';
import { sanitizeStory } from '../domain/story.js';
import { requireRole, requireStaff } from './auth.js';
import { Validator, graphemeLimit } from './validate.js';
import { id, token } from './startup.js';
import { withTransaction } from './db.js';
import { createHash } from 'node:crypto';
import { MARKETS } from '../domain/markets.js';
import { graphemeCount } from '../domain/danish.js';

const LOOK_FILE_LIMIT = 8000000;
const LOOK_ENVELOPE = 100000;

export function registerContentRoutes(app: FastifyInstance): void {
  // Story
  app.get('/api/drops/:dropId/story', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = requireStaff(req);
    const state = req.appState;
    const { dropId } = req.params as { dropId: string };
    const drop = await state.db.query('SELECT id FROM drops WHERE id = $1 AND workspace_id = $2', [dropId, auth.workspaceId]);
    if (!drop.rows[0]) throw new ApiError('not_found');
    const story = await state.db.query('SELECT * FROM stories WHERE drop_id = $1', [dropId]);
    const member = story.rows[0].saved_by ? await state.db.query('SELECT name FROM members WHERE id = $1', [story.rows[0].saved_by]) : null;
    reply.code(200).send({
      html: story.rows[0].html,
      version: story.rows[0].version,
      savedBy: member?.rows[0]?.name ?? null,
      savedAt: toInstantString(story.rows[0].saved_at),
      publishedHtml: story.rows[0].published_html,
      publishedAt: story.rows[0].published_at ? toInstantString(story.rows[0].published_at) : null
    });
  });

  app.put('/api/drops/:dropId/story', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = requireRole(req, ['press_lead']);
    const state = req.appState;
    const { dropId } = req.params as { dropId: string };
    const drop = await state.db.query('SELECT id FROM drops WHERE id = $1 AND workspace_id = $2', [dropId, auth.workspaceId]);
    if (!drop.rows[0]) throw new ApiError('not_found');
    const body = req.body as Record<string, unknown>;
    const v = new Validator();
    const version = Number(body.version);
    if (!Number.isInteger(version)) v.add('version', MESSAGES.required);
    if (typeof body.html !== 'string') v.add('html', MESSAGES.required);
    else if (graphemeCount(body.html) > 100000) v.add('html', MESSAGES.tooLong(100000));
    v.throwIfAny();
    const story = await state.db.query('SELECT * FROM stories WHERE drop_id = $1', [dropId]);
    if (version !== story.rows[0].version) {
      const savedMember = story.rows[0].saved_by ? await state.db.query('SELECT name FROM members WHERE id = $1', [story.rows[0].saved_by]) : null;
      const savedBy = savedMember?.rows[0]?.name ?? 'Someone';
      throw new ApiError('stale_version', {
        savedBy,
        savedAt: toInstantString(story.rows[0].saved_at),
        current: storyOut(story.rows[0], savedBy)
      });
    }
    const clean = sanitizeStory(body.html as string).html;
    await state.db.query(
      'UPDATE stories SET html = $1, version = version + 1, saved_by = $2, saved_at = now() WHERE drop_id = $3',
      [clean, auth.member.id, dropId]
    );
    const fresh = await state.db.query('SELECT * FROM stories WHERE drop_id = $1', [dropId]);
    reply.code(200).send(storyOut(fresh.rows[0], auth.member.name));
  });

  app.post('/api/drops/:dropId/story/publish', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = requireRole(req, ['press_lead']);
    const state = req.appState;
    const { dropId } = req.params as { dropId: string };
    const drop = await state.db.query('SELECT id FROM drops WHERE id = $1 AND workspace_id = $2', [dropId, auth.workspaceId]);
    if (!drop.rows[0]) throw new ApiError('not_found');
    const body = req.body as Record<string, unknown>;
    const version = Number(body.version);
    if (!Number.isInteger(version)) throw new ApiError('validation_failed', { fields: { version: MESSAGES.required } });
    const story = await state.db.query('SELECT * FROM stories WHERE drop_id = $1', [dropId]);
    if (version !== story.rows[0].version) {
      const savedMember = story.rows[0].saved_by ? await state.db.query('SELECT name FROM members WHERE id = $1', [story.rows[0].saved_by]) : null;
      throw new ApiError('stale_version', {
        savedBy: savedMember?.rows[0]?.name ?? 'Someone',
        savedAt: toInstantString(story.rows[0].saved_at),
        current: storyOut(story.rows[0], savedMember?.rows[0]?.name ?? 'Someone')
      });
    }
    await state.db.query('UPDATE stories SET published_html = html, published_at = now(), saved_by = $1, saved_at = now() WHERE drop_id = $2', [auth.member.id, dropId]);
    const fresh = await state.db.query('SELECT * FROM stories WHERE drop_id = $1', [dropId]);
    reply.code(200).send(storyOut(fresh.rows[0], auth.member.name));
  });

  // Previews
  app.get('/api/drops/:dropId/previews', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = requireRole(req, ['press_lead']);
    const state = req.appState;
    const { dropId } = req.params as { dropId: string };
    const drop = await state.db.query('SELECT id FROM drops WHERE id = $1 AND workspace_id = $2', [dropId, auth.workspaceId]);
    if (!drop.rows[0]) throw new ApiError('not_found');
    const res = await state.db.query('SELECT * FROM previews WHERE drop_id = $1 ORDER BY issued_at', [dropId]);
    reply.code(200).send({ items: res.rows.map(previewOut) });
  });

  app.post('/api/drops/:dropId/previews', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = requireRole(req, ['press_lead']);
    const state = req.appState;
    const { dropId } = req.params as { dropId: string };
    const drop = await state.db.query('SELECT * FROM drops WHERE id = $1 AND workspace_id = $2', [dropId, auth.workspaceId]);
    if (!drop.rows[0]) throw new ApiError('not_found');
    if (drop.rows[0].status === 'draft' || drop.rows[0].status === 'withdrawn') throw new ApiError('drop_not_public');
    const body = req.body as Record<string, unknown>;
    const v = new Validator();
    const editorName = typeof body.editorName === 'string' ? body.editorName.trim() : '';
    if (!editorName) v.add('editorName', MESSAGES.required);
    else if (!graphemeLimit(editorName, 80)) v.add('editorName', MESSAGES.tooLong(80));
    const editorEmail = typeof body.editorEmail === 'string' ? body.editorEmail.trim().toLowerCase() : '';
    if (!editorEmail) v.add('editorEmail', MESSAGES.required);
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(editorEmail)) v.add('editorEmail', MESSAGES.email);
    const outlet = typeof body.outlet === 'string' ? body.outlet.trim() : '';
    v.throwIfAny();
    const pid = id('prev');
    const t = token(48);
    const expiresAt = new Date(Date.now() + state.cfg.previewLinkTtlSeconds * 1000);
    await state.db.query(
      'INSERT INTO previews (id, drop_id, editor_name, editor_email, outlet, token, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [pid, dropId, editorName, editorEmail, outlet, t, expiresAt]
    );
    const embargo = drop.rows[0].earliest_go_live_at ? marketTimeWords(new Date(drop.rows[0].earliest_go_live_at), CPH, 'Copenhagen') : 'the embargo';
    const link = `${state.cfg.appPublicUrl}/press/${t}`;
    await state.db.query(
      "INSERT INTO jobs (run_at, kind, payload, workspace_id) VALUES (now(), 'mail', $1, $2)",
      [JSON.stringify({
        kind: 'press_preview', to: editorEmail, toName: editorName,
        subject: `Preview: ${drop.rows[0].name} (embargoed until ${embargo})`,
        body: `Hello ${editorName},\n\nPreview ${drop.rows[0].name} under embargo (until ${embargo}):\n\n${link}\n\nThe link expires at ${toInstantString(expiresAt)}.\n`
      }), auth.workspaceId]
    );
    const fresh = await state.db.query('SELECT * FROM previews WHERE id = $1', [pid]);
    reply.code(201).send(previewOut(fresh.rows[0]));
  });

  app.post('/api/previews/:previewId/revoke', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = requireRole(req, ['press_lead']);
    const state = req.appState;
    const { previewId } = req.params as { previewId: string };
    const res = await state.db.query(
      'SELECT p.* FROM previews p JOIN drops d ON d.id = p.drop_id WHERE p.id = $1 AND d.workspace_id = $2',
      [previewId, auth.workspaceId]
    );
    if (!res.rows[0]) throw new ApiError('not_found');
    if (res.rows[0].status === 'revoked') throw new ApiError('preview_revoked');
    await state.db.query("UPDATE previews SET status = 'revoked' WHERE id = $1", [previewId]);
    const fresh = await state.db.query('SELECT * FROM previews WHERE id = $1', [previewId]);
    reply.code(200).send(previewOut(fresh.rows[0]));
  });

  app.post('/api/previews/:previewId/regenerate', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = requireRole(req, ['press_lead']);
    const state = req.appState;
    const { previewId } = req.params as { previewId: string };
    const res = await state.db.query(
      'SELECT p.*, d.name AS drop_name, d.earliest_go_live_at, d.workspace_id AS ws FROM previews p JOIN drops d ON d.id = p.drop_id WHERE p.id = $1 AND d.workspace_id = $2',
      [previewId, auth.workspaceId]
    );
    if (!res.rows[0]) throw new ApiError('not_found');
    if (res.rows[0].status === 'revoked') throw new ApiError('preview_revoked');
    const old = res.rows[0];
    const t = token(48);
    const expiresAt = new Date(Date.now() + state.cfg.previewLinkTtlSeconds * 1000);
    await withTransaction(state.db, async client => {
      await client.query("UPDATE previews SET status = 'replaced' WHERE id = $1", [previewId]);
      await client.query(
        'INSERT INTO previews (id, drop_id, editor_name, editor_email, outlet, token, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [id('prev'), old.drop_id, old.editor_name, old.editor_email, old.outlet, t, expiresAt]
      );
      const embargo = old.earliest_go_live_at ? marketTimeWords(new Date(old.earliest_go_live_at as Date), CPH, 'Copenhagen') : 'the embargo';
      const link = `${state.cfg.appPublicUrl}/press/${t}`;
      await client.query(
        "INSERT INTO jobs (run_at, kind, payload, workspace_id) VALUES (now(), 'mail', $1, $2)",
        [JSON.stringify({
          kind: 'press_preview', to: old.editor_email, toName: old.editor_name,
          subject: `Preview: ${old.drop_name} (embargoed until ${embargo})`,
          body: `Hello ${old.editor_name},\n\nYour earlier preview link was replaced. Preview ${old.drop_name} under embargo (until ${embargo}):\n\n${link}\n\nThe link expires at ${toInstantString(expiresAt)}.\n`
        }), old.ws]
      );
    });
    const fresh = await state.db.query('SELECT * FROM previews WHERE token = $1', [t]);
    reply.code(200).send(previewOut(fresh.rows[0]));
  });

  app.get('/api/press/:token', async (req: FastifyRequest, reply: FastifyReply) => {
    const state = req.appState;
    const { token: t } = req.params as { token: string };
    const payload = await pressPayload(state, t);
    reply.code(200).send(payload);
  });

  app.get('/api/press/:token/looks/:lookId/image', async (req: FastifyRequest, reply: FastifyReply) => {
    const state = req.appState;
    const { token: t, lookId } = req.params as { token: string; lookId: string };
    const res = await state.db.query('SELECT * FROM previews WHERE token = $1', [t]);
    const p = res.rows[0];
    if (!p) throw new ApiError('not_found');
    await assertPreviewAlive(state, p);
    const look = await state.db.query('SELECT * FROM looks WHERE id = $1 AND drop_id = $2', [lookId, p.drop_id]);
    if (!look.rows[0]) throw new ApiError('not_found');
    try {
      const bytes = await state.storage.get(`looks/${p.drop_id}/${lookId}.${look.rows[0].ext}`);
      reply.code(200).header('content-type', look.rows[0].content_type).send(bytes);
    } catch {
      throw new ApiError('storage_unavailable');
    }
  });

  app.get('/api/press/:token/zip', async (req: FastifyRequest, reply: FastifyReply) => {
    const state = req.appState;
    const { token: t } = req.params as { token: string };
    const res = await state.db.query('SELECT * FROM previews WHERE token = $1', [t]);
    const p = res.rows[0];
    if (!p) throw new ApiError('not_found');
    await assertPreviewAlive(state, p);
    const drop = await state.db.query('SELECT * FROM drops WHERE id = $1', [p.drop_id]);
    const looks = await state.db.query('SELECT * FROM looks WHERE drop_id = $1 ORDER BY position', [p.drop_id]);
    const files: { name: string; data: Buffer; sha256: string }[] = [];
    for (const look of looks.rows) {
      try {
        const bytes = await state.storage.get(`looks/${p.drop_id}/${look.id}.${look.ext}`);
        const name = `look-${String(look.position).padStart(2, '0')}.${look.ext}`;
        files.push({ name, data: bytes, sha256: createHash('sha256').update(bytes).digest('hex') });
      } catch {
        throw new ApiError('storage_unavailable');
      }
    }
    const embargo = drop.rows[0].earliest_go_live_at ? toInstantString(new Date(drop.rows[0].earliest_go_live_at as Date)) : null;
    const manifest = {
      dropName: drop.rows[0].name,
      embargoUntil: embargo,
      files: files.map(f => ({ name: f.name, sizeBytes: f.data.length, sha256: f.sha256 }))
    };
    const zip = await buildZip(files, manifest);
    const key = `press/${p.id}.zip`;
    try {
      await state.storage.put(key, zip, 'application/zip');
    } catch {
      throw new ApiError('storage_unavailable');
    }
    reply.code(200).header('content-type', 'application/zip').send(zip);
  });
}

async function assertPreviewAlive(state: { db: import('./db.js').Db }, p: Record<string, unknown>): Promise<void> {
  const drop = await state.db.query('SELECT status FROM drops WHERE id = $1', [p.drop_id]);
  if (!drop.rows[0]) throw new ApiError('not_found');
  if (drop.rows[0].status === 'withdrawn') throw new ApiError('drop_withdrawn');
  if (p.status === 'revoked') throw new ApiError('link_revoked');
  if (p.status === 'replaced') throw new ApiError('link_replaced');
  if (new Date(p.expires_at as Date).getTime() <= Date.now()) throw new ApiError('link_expired');
}

async function pressPayload(state: { db: import('./db.js').Db }, t: string): Promise<Record<string, unknown>> {
  const res = await state.db.query('SELECT * FROM previews WHERE token = $1', [t]);
  const p = res.rows[0];
  if (!p) throw new ApiError('not_found');
  await assertPreviewAlive(state, p);
  const drop = await state.db.query('SELECT * FROM drops WHERE id = $1', [p.drop_id]);
  const story = await state.db.query('SELECT published_html FROM stories WHERE drop_id = $1', [p.drop_id]);
  const looks = await state.db.query('SELECT * FROM looks WHERE drop_id = $1 ORDER BY position', [p.drop_id]);
  const markets = await state.db.query('SELECT * FROM drop_markets WHERE drop_id = $1', [p.drop_id]);
  return {
    brand: drop.rows[0].brand,
    dropName: drop.rows[0].name,
    type: drop.rows[0].type,
    embargoUntil: drop.rows[0].earliest_go_live_at ? toInstantString(new Date(drop.rows[0].earliest_go_live_at)) : null,
    expiresAt: toInstantString(new Date(p.expires_at)),
    markets: markets.rows.map((m: Record<string, unknown>) => ({
      market: m.market, city: MARKETS.find(x => x.market === m.market)?.city ?? m.market,
      goLiveAt: m.go_live_at ? toInstantString(new Date(m.go_live_at as Date)) : null
    })),
    storyHtml: story.rows[0]?.published_html ?? null,
    looks: looks.rows.map((l: Record<string, unknown>) => ({
      id: l.id, position: l.position, title: l.title, altText: l.alt_text,
      imageUrl: `/api/press/${t}/looks/${l.id}/image`, width: l.width, height: l.height
    }))
  };
}

function previewOut(p: Record<string, unknown>): Record<string, unknown> {
  return {
    id: p.id, editorName: p.editor_name, editorEmail: p.editor_email, outlet: p.outlet,
    status: p.status, issuedAt: toInstantString(new Date(p.issued_at as Date)),
    expiresAt: toInstantString(new Date(p.expires_at as Date)),
    link: `/press/${p.token}`
  };
}

function storyOut(row: Record<string, unknown>, savedBy: string): Record<string, unknown> {
  return {
    html: row.html, version: row.version, savedBy,
    savedAt: toInstantString(new Date(row.saved_at as Date)),
    publishedHtml: row.published_html,
    publishedAt: row.published_at ? toInstantString(new Date(row.published_at as Date)) : null
  };
}

export async function looksOut(db: import('./db.js').Db, dropId: string): Promise<Record<string, unknown>> {
  const looks = await db.query('SELECT * FROM looks WHERE drop_id = $1 ORDER BY position', [dropId]);
  const order = await db.query('SELECT * FROM look_orders WHERE drop_id = $1', [dropId]);
  const savedMember = order.rows[0]?.saved_by ? await db.query('SELECT name FROM members WHERE id = $1', [order.rows[0].saved_by]) : null;
  const lastSavedMember = looks.rows.length > 0 ? null : null;
  void lastSavedMember;
  const savedBy = savedMember?.rows[0]?.name
    ?? (order.rows[0] ? 'A teammate' : null);
  return {
    items: looks.rows.map((l: Record<string, unknown>) => ({
      id: l.id, position: l.position, title: l.title, altText: l.alt_text,
      imageUrl: `/api/drops/${dropId}/looks/${l.id}/image`,
      width: l.width, height: l.height, contentType: l.content_type, sizeBytes: Number(l.size_bytes)
    })),
    orderVersion: order.rows[0]?.order_version ?? 1,
    savedBy,
    savedAt: order.rows[0] ? toInstantString(new Date(order.rows[0].saved_at as Date)) : null
  };
}

// A minimal, well-formed ZIP writer: stored (uncompressed) entries plus the
// manifest, with correct CRC-32 and central directory.
async function buildZip(files: { name: string; data: Buffer; sha256: string }[], manifest: unknown): Promise<Buffer> {
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8');
  const entries = [...files, { name: 'manifest.json', data: manifestBytes, sha256: '' }];
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const nameBytes = Buffer.from(e.name, 'utf8');
    const crc = crc32(e.data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt32LE(crc, 10);
    header.writeUInt32LE(e.data.length, 14);
    header.writeUInt32LE(e.data.length, 18);
    header.writeUInt16LE(nameBytes.length, 22);
    header.writeUInt16LE(0, 24);
    chunks.push(header, nameBytes, e.data);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(e.data.length, 20);
    cd.writeUInt32LE(e.data.length, 24);
    cd.writeUInt16LE(nameBytes.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cd, nameBytes]));
    offset += header.length + nameBytes.length + e.data.length;
  }
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, centralBytes, end]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

