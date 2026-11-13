import crypto from 'node:crypto';
import type { App, User } from './app.ts';
import { recordAction } from './app.ts';
import { requireUser } from './platform.ts';
import type { RouteContext } from './http.ts';
import { ApiError, sendJson, validationFailed } from './http.ts';
import { readJson, asString, asInteger, asStringArray, type Value } from './params.ts';
import { FIELDS, illegalTransition } from '../core/copy.ts';
import { STATUS_LABEL, transitionAllowed, transitionWho, type ItemStatus } from '../../shared/lifecycle.ts';
import { parseIsoWithOffset, toOffsetIso } from '../core/time.ts';

export function registerStudioRoutes(app: App, route: (method: string, pattern: string, handler: (ctx: RouteContext) => Promise<void>) => void): void {
  const requireCurator = async (ctx: RouteContext): Promise<User> => {
    const user = await requireUser(ctx, app);
    if (user.role !== 'curator' && user.role !== 'lead_curator') throw new ApiError(403, 'forbidden');
    return user;
  };

  route('GET', '/api/curator/items', async (ctx) => {
    await requireCurator(ctx);
    const type = ctx.query.get('type');
    const status = ctx.query.get('status');
    const items: Array<Record<string, unknown>> = [];
    if (!type || type === 'chapter') {
      const rows = await app.pool.query(`SELECT number, title, status, owner_email, publish_at FROM chapters`);
      for (const r of rows.rows) {
        if (status && r['status'] !== status) continue;
        items.push({
          id: `chapter-${Number(r['number'])}`,
          type: 'chapter',
          title: String(r['title']),
          status: String(r['status']),
          owner_email: String(r['owner_email']),
          publish_at: r['publish_at'] ? toOffsetIso(new Date(r['publish_at'] as Date).getTime()) : null,
          chapter: Number(r['number']),
        });
      }
    }
    if (!type || type === 'event') {
      const rows = await app.pool.query(`SELECT id, chapter, title, status, owner_email, publish_at FROM events`);
      for (const r of rows.rows) {
        if (status && r['status'] !== status) continue;
        items.push({
          id: String(r['id']),
          type: 'event',
          title: String(r['title']),
          status: String(r['status']),
          owner_email: String(r['owner_email']),
          publish_at: r['publish_at'] ? toOffsetIso(new Date(r['publish_at'] as Date).getTime()) : null,
          chapter: Number(r['chapter']),
        });
      }
    }
    items.sort((a, b) => String(a['id']).localeCompare(String(b['id'])));
    sendJson(ctx.res, 200, { items });
  });

  route('POST', '/api/curator/events', async (ctx) => {
    const user = await requireCurator(ctx);
    const body = await readJson(ctx);
    const chapter = asInteger(body['chapter']);
    const year = asInteger(body['year']);
    const title = asString(body['title']);
    const summary = asString(body['summary']);
    const sourceIds = asStringArray(body['source_ids']) ?? [];
    const fields: Record<string, string> = {};
    if (chapter === null || chapter < 1 || chapter > 8) fields['chapter'] = 'Check the highlighted fields.';
    if (year === null || year < 1600 || year > 2100) fields['year'] = 'Check the highlighted fields.';
    if (title === null || title.trim().length < 3 || title.trim().length > 120) fields['title'] = 'Check the highlighted fields.';
    if (summary === null || summary.trim().length < 10 || summary.trim().length > 600) fields['summary'] = 'Check the highlighted fields.';
    if (sourceIds.length > 5) fields['source_ids'] = 'Check the highlighted fields.';
    if (Object.keys(fields).length) throw validationFailed(fields);

    const id = `ev-${crypto.randomUUID()}`;
    await app.pool.query(
      `INSERT INTO events (id, chapter, year, title, summary, owner_email, status) VALUES ($1,$2,$3,$4,$5,$6,'draft')`,
      [id, chapter, year, title!.trim(), summary!.trim(), user.email],
    );
    if (sourceIds.length) {
      const valid = await app.pool.query(`SELECT id FROM sources WHERE id = ANY($1)`, [sourceIds]);
      for (const s of valid.rows) {
        await app.pool.query(`INSERT INTO event_sources (event_id, source_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, String(s['id'])]);
      }
    }
    await recordAction(app, user.email, 'item_created', 'event', id, { chapter });
    sendJson(ctx.res, 201, {
      item: { id, type: 'event', title: title!.trim(), status: 'draft', owner_email: user.email, publish_at: null, chapter },
    });
  });

  route('PATCH', '/api/curator/items/:id', async (ctx) => {
    const user = await requireCurator(ctx);
    const id = itemIdFromPath(ctx.path);
    const body = await readJson(ctx);
    const existing = await findItem(app, id);
    if (!existing) throw new ApiError(404, 'not_found');
    if (existing.owner !== user.email && user.role !== 'lead_curator') throw new ApiError(403, 'forbidden');
    if (existing.status !== 'draft') throw new ApiError(409, 'not_editable');

    const fields: Record<string, string> = {};
    const updates: string[] = [];
    const params: Value[] = [];
    const push = (col: string, value: Value): void => {
      params.push(value);
      updates.push(`${col} = $${params.length}`);
    };

    if (existing.kind === 'chapter') {
      if (body['title'] !== undefined) {
        const v = asString(body['title']);
        if (v === null || v.trim().length < 3) fields['title'] = 'Check the highlighted fields.';
        else push('title', v.trim());
      }
      if (body['era'] !== undefined) {
        const v = asString(body['era']);
        if (v === null || v.length === 0) fields['era'] = 'Check the highlighted fields.';
        else push('era', v);
      }
      if (body['body'] !== undefined) {
        const v = asString(body['body']);
        if (v === null || v.length < 50) fields['body'] = 'Check the highlighted fields.';
        else push('body', v);
      }
      if (body['sightline_deg'] !== undefined) {
        const v = asInteger(body['sightline_deg']);
        if (v === null || v < -60 || v > 60 || v % 3 !== 0) fields['sightline_deg'] = 'Check the highlighted fields.';
        else push('sightline_deg', v);
      }
      if (Object.keys(fields).length) throw validationFailed(fields);
      if (updates.length) {
        params.push(existing.number);
        await app.pool.query(`UPDATE chapters SET ${updates.join(', ')} WHERE number = $${params.length}`, params);
      }
    } else {
      if (body['chapter'] !== undefined) {
        const v = asInteger(body['chapter']);
        if (v === null || v < 1 || v > 8) fields['chapter'] = 'Check the highlighted fields.';
        else push('chapter', v);
      }
      if (body['year'] !== undefined) {
        const v = asInteger(body['year']);
        if (v === null || v < 1600 || v > 2100) fields['year'] = 'Check the highlighted fields.';
        else push('year', v);
      }
      if (body['title'] !== undefined) {
        const v = asString(body['title']);
        if (v === null || v.trim().length < 3 || v.trim().length > 120) fields['title'] = 'Check the highlighted fields.';
        else push('title', v.trim());
      }
      if (body['summary'] !== undefined) {
        const v = asString(body['summary']);
        if (v === null || v.trim().length < 10 || v.trim().length > 600) fields['summary'] = 'Check the highlighted fields.';
        else push('summary', v.trim());
      }
      if (body['source_ids'] !== undefined) {
        const arr = asStringArray(body['source_ids']);
        if (arr === null || arr.length > 5) fields['source_ids'] = 'Check the highlighted fields.';
        else {
          await app.pool.query(`DELETE FROM event_sources WHERE event_id = $1`, [existing.id]);
          if (arr.length) {
            const valid = await app.pool.query(`SELECT id FROM sources WHERE id = ANY($1)`, [arr]);
            for (const s of valid.rows) {
              await app.pool.query(`INSERT INTO event_sources (event_id, source_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [existing.id, String(s['id'])]);
            }
          }
        }
      }
      if (Object.keys(fields).length) throw validationFailed(fields);
      if (updates.length) {
        params.push(existing.id);
        await app.pool.query(`UPDATE events SET ${updates.join(', ')} WHERE id = $${params.length}`, params);
      }
    }
    await recordAction(app, user.email, 'item_edited', existing.kind, existing.id);
    const after = await findItem(app, id);
    sendJson(ctx.res, 200, { item: toStudioItem(after!) });
  });

  route('POST', '/api/curator/items/:id/transitions', async (ctx) => {
    const user = await requireCurator(ctx);
    const id = itemIdFromPath(ctx.path);
    const body = await readJson(ctx);
    const to = asString(body['to']);
    if (to !== 'draft' && to !== 'review' && to !== 'scheduled' && to !== 'published' && to !== 'withdrawn') {
      throw validationFailed({ to: 'Check the highlighted fields.' });
    }
    const existing = await findItem(app, id);
    if (!existing) throw new ApiError(404, 'not_found');
    const owner = existing.owner === user.email;
    const lead = user.role === 'lead_curator';
    if (!owner && !lead) throw new ApiError(403, 'forbidden');

    const fields: Record<string, string> = {};
    let publishAtMs: number | null = null;
    if (to === 'scheduled') {
      const publishAt = asString(body['publish_at']);
      if (publishAt === null) {
        fields['publish_at'] = FIELDS.publishTimeFormat;
      } else {
        const ms = parseIsoWithOffset(publishAt);
        if (ms === null) fields['publish_at'] = FIELDS.publishTimeFormat;
        else if (ms <= app.now()) fields['publish_at'] = FIELDS.publishTime;
        else publishAtMs = ms;
      }
    }
    let reason: string | null = null;
    if (to === 'withdrawn') {
      reason = asString(body['reason']);
      if (reason === null || reason.trim().length < 3 || reason.trim().length > 500) fields['reason'] = FIELDS.reason;
    }
    if (Object.keys(fields).length) throw validationFailed(fields);

    const who = transitionAllowed(existing.status, to as ItemStatus) ? transitionWho(existing.status, to as ItemStatus) : null;
    if (!who || who === 'server_only') {
      throw new ApiError(409, 'illegal_transition', undefined, illegalTransition(STATUS_LABEL[existing.status]));
    }
    if (who === 'lead_only' && !lead) throw new ApiError(403, 'lead_only');

    const updated = await transitionItem(app, existing, to as ItemStatus, publishAtMs);
    await recordAction(app, user.email, 'transition', existing.kind, existing.id, {
      from: existing.status,
      to,
      ...(to === 'withdrawn' && reason !== null ? { reason: reason.trim() } : {}),
    });

    if (to === 'review') await sendReviewNotice(app, existing.title);
    if (to === 'withdrawn') await sendWithdrawalNotice(app, existing.owner, existing.title);
    sendJson(ctx.res, 200, { item: toStudioItem(updated) });
  });

  route('POST', '/api/curator/sources', async (ctx) => {
    const user = await requireCurator(ctx);
    const body = await readJson(ctx);
    const citation = asString(body['citation']);
    if (citation === null || citation.trim().length < 5 || citation.trim().length > 300) {
      throw validationFailed({ citation: FIELDS.citation });
    }
    const last = await app.pool.query(
      `SELECT id FROM sources ORDER BY CAST(split_part(id, '-', 2) AS integer) DESC LIMIT 1`,
    );
    const lastId = last.rows[0]?.['id'];
    const nextN = typeof lastId === 'string' ? Number(lastId.split('-')[1]) + 1 : 1;
    const id = `src-${nextN}`;
    await app.pool.query(`INSERT INTO sources (id, citation) VALUES ($1,$2)`, [id, citation.trim()]);
    await recordAction(app, user.email, 'source_created', 'source', id);
    sendJson(ctx.res, 201, { source: { id, citation: citation.trim() } });
  });

  route('POST', '/api/curator/media', async (ctx) => {
    const user = await requireCurator(ctx);
    const contentTypeHeader = String(ctx.req.headers['content-type'] ?? '');
    if (!contentTypeHeader.startsWith('multipart/form-data')) {
      throw new ApiError(415, 'unsupported_media_type');
    }
    const raw = await ctx.rawBody();
    const parsed = parseMultipart(raw, contentTypeHeader);
    const file = parsed['file'];
    if (!(file instanceof ParsedFile)) throw validationFailed({ file: 'Check the highlighted fields.' });
    const kind = asString(parsed['kind']);
    const itemId = asString(parsed['item_id']);
    const transcript = asString(parsed['transcript']);
    if (kind !== 'narration' && kind !== 'image' && kind !== 'scan') throw validationFailed({ kind: 'Check the highlighted fields.' });
    if (!itemId) throw new ApiError(404, 'not_found');
    const item = await findItem(app, itemId);
    if (!item) throw new ApiError(404, 'not_found');
    const allowed: Record<string, string[]> = {
      narration: ['audio/mpeg', 'audio/ogg'],
      image: ['image/png', 'image/jpeg', 'image/webp'],
      scan: ['image/png', 'image/jpeg', 'application/pdf'],
    };
    if (!allowed[kind]!.includes(file.contentType)) throw validationFailed({ file: FIELDS.uploadType });
    if (file.data.length > 20_000_000) throw validationFailed({ file: FIELDS.uploadSize });
    if (file.data.length > 0 && !signatureMatches(file.contentType, file.data)) {
      throw validationFailed({ file: FIELDS.uploadType });
    }
    if (kind === 'narration' && (transcript === null || transcript.trim().length === 0)) {
      throw validationFailed({ transcript: FIELDS.transcript });
    }

    const id = crypto.randomUUID();
    const safeName = sanitizeFilename(file.filename);
    const key = `media/${id}/${safeName}`;
    try {
      await app.storage.put(key, file.data, file.contentType);
    } catch {
      throw new ApiError(503, 'storage_unavailable');
    }
    await app.pool.query(
      `INSERT INTO media (id, kind, item_id, filename, bytes, content_type, storage_key, transcript)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, kind, itemId, safeName, file.data.length, file.contentType, key, transcript],
    );
    await recordAction(app, user.email, 'media_uploaded', item.kind, itemId, { filename: safeName, kind });
    sendJson(ctx.res, 201, {
      media: { id, kind, item_id: itemId, filename: safeName, bytes: file.data.length, content_type: file.contentType, key },
    });
  });
}

function itemIdFromPath(path: string): string {
  const parts = path.split('/');
  const idx = parts.indexOf('transitions');
  if (idx === -1) return parts[parts.length - 1] ?? '';
  return parts[idx - 1] ?? '';
}

interface ItemRecord {
  id: string;
  kind: 'chapter' | 'event';
  number: number | null;
  status: ItemStatus;
  owner: string;
  title: string;
  publishAtMs: number | null;
}

async function findItem(app: App, id: string): Promise<ItemRecord | null> {
  if (/^chapter-\d$/.test(id)) {
    const n = Number(id.split('-')[1]);
    const res = await app.pool.query(`SELECT number, title, status, owner_email, publish_at FROM chapters WHERE number = $1`, [n]);
    const row = res.rows[0];
    if (!row) return null;
    return { id, kind: 'chapter', number: n, status: row['status'] as ItemStatus, owner: String(row['owner_email']), title: String(row['title']), publishAtMs: row['publish_at'] ? new Date(row['publish_at'] as Date).getTime() : null };
  }
  const res = await app.pool.query(`SELECT id, title, status, owner_email, publish_at FROM events WHERE id = $1`, [id]);
  const row = res.rows[0];
  if (!row) return null;
  return { id, kind: 'event', number: null, status: row['status'] as ItemStatus, owner: String(row['owner_email']), title: String(row['title']), publishAtMs: row['publish_at'] ? new Date(row['publish_at'] as Date).getTime() : null };
}

async function transitionItem(app: App, item: ItemRecord, to: ItemStatus, publishAtMs: number | null): Promise<ItemRecord> {
  if (item.kind === 'chapter') {
    const res = await app.pool.query(
      `UPDATE chapters SET status = $2, publish_at = $3 WHERE number = $1 AND status = $4 RETURNING number, title, status, owner_email, publish_at`,
      [item.number, to, publishAtMs ? new Date(publishAtMs) : null, item.status],
    );
    const row = res.rows[0];
    if (!row) throw new ApiError(409, 'illegal_transition', undefined, illegalTransition(STATUS_LABEL[item.status]));
    return { id: item.id, kind: 'chapter', number: item.number, status: row['status'] as ItemStatus, owner: String(row['owner_email']), title: String(row['title']), publishAtMs: row['publish_at'] ? new Date(row['publish_at'] as Date).getTime() : null };
  }
  const res = await app.pool.query(
    `UPDATE events SET status = $2, publish_at = $3 WHERE id = $1 AND status = $4 RETURNING id, title, status, owner_email, publish_at`,
    [item.id, to, publishAtMs ? new Date(publishAtMs) : null, item.status],
  );
  const row = res.rows[0];
  if (!row) throw new ApiError(409, 'illegal_transition', undefined, illegalTransition(STATUS_LABEL[item.status]));
  return { id: item.id, kind: 'event', number: null, status: row['status'] as ItemStatus, owner: String(row['owner_email']), title: String(row['title']), publishAtMs: row['publish_at'] ? new Date(row['publish_at'] as Date).getTime() : null };
}

function toStudioItem(item: ItemRecord): Record<string, unknown> {
  return {
    id: item.id,
    type: item.kind,
    title: item.title,
    status: item.status,
    owner_email: item.owner,
    publish_at: item.publishAtMs === null ? null : toOffsetIso(item.publishAtMs),
    chapter: item.number,
  };
}

async function sendReviewNotice(app: App, title: string): Promise<void> {
  const leads = await app.pb.listAllUsersByRole('lead_curator');
  const lead = leads[0];
  if (!lead) return;
  const name = String(lead['name'] ?? 'Lead curator');
  await app.mail.enqueue({
    toEmail: String(lead['email']),
    toName: name,
    subject: `For review: ${title}`,
    body: [`Hello ${name},`, '', `For review: ${title}`, '', 'Halden Reading Room'].join('\n'),
    dedupeKey: `review:${title}`,
  });
}

async function sendWithdrawalNotice(app: App, ownerEmail: string, title: string): Promise<void> {
  const user = await app.pb.getUserByEmail(ownerEmail);
  await app.mail.enqueue({
    toEmail: ownerEmail,
    toName: user?.name ?? 'Curator',
    subject: `Withdrawn: ${title}`,
    body: [`Hello ${user?.name ?? 'curator'},`, '', `Withdrawn: ${title}`, '', 'Halden Reading Room'].join('\n'),
    dedupeKey: `withdrawn:${title}`,
  });
}

function sanitizeFilename(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9._-]/g, '-');
}

function signatureMatches(declared: string, data: Buffer): boolean {
  if (declared === 'image/png') return data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (declared === 'image/jpeg') return data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  if (declared === 'application/pdf') return data.subarray(0, 5).toString('latin1') === '%PDF-';
  if (declared === 'audio/mpeg') {
    return data.subarray(0, 3).toString('latin1') === 'ID3' || (data[0] === 0xff && (data[1]! & 0xe0) === 0xe0);
  }
  if (declared === 'audio/ogg') return data.subarray(0, 4).toString('latin1') === 'OggS';
  if (declared === 'image/webp') {
    return data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP';
  }
  return false;
}

export class ParsedFile {
  constructor(
    public filename: string,
    public contentType: string,
    public data: Buffer,
  ) {}
}

function parseMultipart(raw: string, contentTypeHeader: string): Record<string, string | ParsedFile> {
  const m = contentTypeHeader.match(/boundary="?([^";]+)"?/);
  if (!m) return {};
  const boundary = `--${m[1]}`;
  const buf = Buffer.from(raw, 'binary');
  const text = buf.toString('binary');
  const parts = text.split(boundary).filter((p) => p.includes('Content-Disposition'));
  const out: Record<string, string | ParsedFile> = {};
  for (const part of parts) {
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const headers = part.slice(0, headerEnd);
    const rest = part.slice(headerEnd + 4);
    const nameMatch = headers.match(/name="([^"]+)"/);
    const filenameMatch = headers.match(/filename="([^"]*)"/);
    const contentTypeMatch = headers.match(/Content-Type:\s*([^\r\n]+)/i);
    const body = rest.endsWith('\r\n') ? rest.slice(0, -2) : rest;
    if (!nameMatch) continue;
    const name = nameMatch[1]!;
    if (filenameMatch) {
      out[name] = new ParsedFile(
        filenameMatch[1] ?? '',
        (contentTypeMatch?.[1] ?? 'application/octet-stream').trim(),
        Buffer.from(body, 'binary'),
      );
    } else {
      out[name] = body;
    }
  }
  return out;
}
