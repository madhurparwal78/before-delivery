import type { Model } from '../../domain/model.js';
import { err, notFound, forbidden } from '../../http/errors.js';
import type { Ctx, Router } from '../../http/router.js';
import { newId } from '../../services/ids.js';
import { readMultipartFile } from '../../http/body.js';
import type { S3 } from '../../services/s3.js';
import { isoInBrussels } from '../../domain/time.js';
import { audienceFor } from '../../services/live.js';

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const JPEG_SIG = Buffer.from([0xff, 0xd8, 0xff]);
const PDF_SIG = Buffer.from([0x25, 0x50, 0x44, 0x46]);

export function registerFileRoutes(model: Model, router: Router, s3: S3): void {
  const { db, cfg, clock, live } = model;

  router.add('POST', '/api/me/photo', async (ctx: Ctx) => {
    const member = await model.memberById(ctx.memberId!);
    if (!member) throw notFound();
    const uploaded = await readMultipartFile(ctx.req, cfg.photoMaxBytes + 64 * 1024);
    if (!uploaded) throw err(422, 'validation_failed', 'Check the highlighted fields.', { file: 'Choose a file.' });
    if (uploaded.file.length > cfg.photoMaxBytes) {
      throw err(422, 'file_too_large', `The file must be ${Math.floor(cfg.photoMaxBytes / 1_048_576)} MB or smaller.`);
    }
    if (!isPng(uploaded.file) && !isJpeg(uploaded.file)) throw err(422, 'file_type', 'Upload a PNG or JPEG file.');
    const fileId = newId();
    const key = `photos/${member.id}/${fileId}`;
    const ok = await s3.putObject(key, uploaded.file, isPng(uploaded.file) ? 'image/png' : 'image/jpeg');
    if (!ok) throw err(503, 'storage_unavailable');
    const confirm = await s3.headObject(key);
    if (!confirm.exists || confirm.size !== uploaded.file.length) throw err(503, 'storage_unavailable');
    const now = clock.nowMs();
    await db.query('INSERT INTO files (id, kind, owner_id, content_type, bytes, object_key, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)', [fileId, 'photo', member.id, isPng(uploaded.file) ? 'image/png' : 'image/jpeg', uploaded.file.length, key, now]);
    await db.query('UPDATE members SET photo_file_id = $2 WHERE id = $1', [member.id, fileId]);
    return { status: 201, payload: { file_id: fileId, photo_url: `/api/files/${fileId}` } };
  }, { member: true, json: false });

  router.add('POST', '/api/me/id-document', async (ctx: Ctx) => {
    const member = await model.memberById(ctx.memberId!);
    if (!member) throw notFound();
    const uploaded = await readMultipartFile(ctx.req, cfg.idDocMaxBytes + 64 * 1024);
    if (!uploaded) throw err(422, 'validation_failed', 'Check the highlighted fields.', { file: 'Choose a file.' });
    if (uploaded.file.length > cfg.idDocMaxBytes) {
      throw err(422, 'file_too_large', `The file must be ${Math.floor(cfg.idDocMaxBytes / 1_048_576)} MB or smaller.`);
    }
    const contentType = detect(uploaded.file);
    if (contentType === null) throw err(422, 'file_type', 'Upload a PNG, JPEG or PDF file.');
    const fileId = newId();
    const key = `id-documents/${member.id}/${fileId}`;
    const ok = await s3.putObject(key, uploaded.file, contentType);
    if (!ok) throw err(503, 'storage_unavailable');
    const confirm = await s3.headObject(key);
    if (!confirm.exists || confirm.size !== uploaded.file.length) throw err(503, 'storage_unavailable');
    const now = clock.nowMs();
    const client = await db.connect();
    let docId = '';
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO files (id, kind, owner_id, content_type, bytes, object_key, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)', [fileId, 'id_document', member.id, contentType, uploaded.file.length, key, now]);
      await client.query(`UPDATE id_documents SET state = 'replaced' WHERE member_id = $1 AND state = 'pending'`, [member.id]);
      docId = newId();
      await client.query('INSERT INTO id_documents (id, member_id, file_id, state, uploaded_at) VALUES ($1,$2,$3,$4,$5)', [docId, member.id, fileId, 'pending', now]);
      await client.query(`UPDATE members SET id_state = 'pending', id_reason = NULL WHERE id = $1`, [member.id]);
      await client.query('COMMIT');
      client.release();
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
      throw e;
    }
    return { status: 201, payload: { document_id: docId, file_id: fileId, id_state: 'pending' } };
  }, { member: true, json: false });

  router.add('GET', '/api/me/id-document', async (ctx: Ctx) => {
    const member = await model.memberById(ctx.memberId!);
    if (!member) throw notFound();
    return { status: 200, payload: { id_state: member.id_state, reason: member.id_reason, file_id: null } };
  }, { member: true, json: false });

  router.add('GET', '/api/files/:id', async (ctx: Ctx) => {
    const member = ctx.memberId ? await model.memberById(ctx.memberId) : null;
    void member;
    const row = await db.query('SELECT * FROM files WHERE id = $1', [ctx.params.id]);
    if (row.rows.length === 0) throw notFound();
    const f = row.rows[0] as { id: string; kind: string; owner_id: string; content_type: string; object_key: string };
    if (f.kind === 'id_document') {
      const allowed = member !== null && (member.id === f.owner_id || member.roles.includes('founder'));
      if (!allowed) throw notFound();
    } else if (member === null) {
      throw notFound();
    }
    const obj = await s3.getObject(f.object_key);
    if (!obj.ok || obj.body === null) throw err(503, 'storage_unavailable');
    ctx.res.writeHead(200, { 'Content-Type': obj.contentType ?? f.content_type, 'Content-Length': String(obj.body.length), 'Cache-Control': 'private, max-age=60' });
    ctx.res.end(obj.body);
    return null;
  }, { member: true, json: false });

  // ---------- founder ----------

  router.add('GET', '/api/founder/id-reviews', async (ctx: Ctx) => {
    const member = await model.memberById(ctx.memberId!);
    if (!member || !member.roles.includes('founder')) throw forbidden();
    const rows = await db.query(
      `SELECT d.id, d.file_id, d.uploaded_at, m.id AS member_id, m.display_name, m.photo_file_id, m.roles, m.id_state
       FROM id_documents d JOIN members m ON m.id = d.member_id
       WHERE d.state = 'pending' ORDER BY d.uploaded_at ASC`,
    );
    const out = [];
    for (const d of rows.rows) {
      out.push({
        id: d.id,
        member: {
          id: d.member_id,
          display_name: d.display_name,
          roles: d.roles,
          id_state: d.id_state,
          photo_url: d.photo_file_id ? `/api/files/${d.photo_file_id}` : null,
          rating: { average: null, count: 0 },
        },
        file_id: d.file_id ?? null,
        uploaded_at: isoInBrussels(Number(d.uploaded_at)),
      });
    }
    return { status: 200, payload: { documents: out } };
  }, { member: true, json: false });

  router.add('POST', '/api/founder/id-reviews/:id/approve', async (ctx: Ctx) => {
    const founder = await model.memberById(ctx.memberId!);
    if (!founder || !founder.roles.includes('founder')) throw forbidden();
    const row = await db.query(`SELECT * FROM id_documents WHERE id = $1`, [ctx.params.id]);
    if (row.rows.length === 0) throw notFound();
    const d = row.rows[0] as { id: string; member_id: string; state: string };
    if (d.state !== 'pending') throw err(409, 'already_decided');
    const now = clock.nowMs();
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE id_documents SET state = 'approved' WHERE id = $1`, [d.id]);
      await client.query(`UPDATE members SET id_state = 'verified', id_reason = NULL WHERE id = $1`, [d.member_id]);
      const m = await model.memberById(d.member_id);
      if (m) await model.mailer.queue(client, 'id_review', m.email, 'Your Longseat ID review', 'Your ID is verified.', now);
      await client.query('COMMIT');
      client.release();
      const rows = await db.query(`SELECT id, to_email FROM outbox WHERE kind = 'id_review' AND created_at = $1`, [now]);
      for (const r of rows.rows) await model.mailer.trySend(db, r.id, now).catch(() => undefined);
      live.push({ type: 'id_review', data: { id_state: 'verified', reason: null }, audience: audienceFor({ memberIds: [d.member_id] }) });
      return { status: 200, payload: { id_state: 'verified' } };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
      throw e;
    }
  }, { member: true, json: false });

  router.add('POST', '/api/founder/id-reviews/:id/reject', async (ctx: Ctx) => {
    const founder = await model.memberById(ctx.memberId!);
    if (!founder || !founder.roles.includes('founder')) throw forbidden();
    const row = await db.query(`SELECT * FROM id_documents WHERE id = $1`, [ctx.params.id]);
    if (row.rows.length === 0) throw notFound();
    const d = row.rows[0] as { id: string; member_id: string; state: string };
    if (d.state !== 'pending') throw err(409, 'already_decided');
    const body = ctx.body as { reason?: unknown };
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (reason.length < 1 || reason.length > 200) {
      throw err(422, 'validation_failed', 'Check the highlighted fields.', { reason: 'Write a reason of 1 to 200 characters.' });
    }
    const now = clock.nowMs();
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE id_documents SET state = 'rejected', reason = $2 WHERE id = $1`, [d.id, reason]);
      await client.query(`UPDATE members SET id_state = 'rejected', id_reason = $2 WHERE id = $1`, [d.member_id, reason]);
      const m = await model.memberById(d.member_id);
      if (m) await model.mailer.queue(client, 'id_review', m.email, 'Your Longseat ID review', `Please upload your ID again: ${reason}.`, now);
      await client.query('COMMIT');
      client.release();
      const rows = await db.query(`SELECT id, to_email FROM outbox WHERE kind = 'id_review' AND created_at = $1`, [now]);
      for (const r of rows.rows) await model.mailer.trySend(db, r.id, now).catch(() => undefined);
      live.push({ type: 'id_review', data: { id_state: 'rejected', reason }, audience: audienceFor({ memberIds: [d.member_id] }) });
      return { status: 200, payload: { id_state: 'rejected' } };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
      throw e;
    }
  });

  router.add('GET', '/api/founder/outbox', async (ctx: Ctx) => {
    const member = await model.memberById(ctx.memberId!);
    if (!member || !member.roles.includes('founder')) throw forbidden();
    const rows = await db.query('SELECT * FROM outbox ORDER BY created_at DESC LIMIT 200');
    return {
      status: 200,
      payload: {
        items: rows.rows.map(r => ({
          id: r.id,
          kind: r.kind,
          to: r.to_email,
          subject: r.subject,
          status: r.status,
          attempts: Number(r.attempts),
          last_attempt_at: r.last_attempt_at ? isoInBrussels(Number(r.last_attempt_at)) : null,
        })),
      },
    };
  }, { member: true, json: false });

  router.add('GET', '/api/founder/bookings-by-state', async (ctx: Ctx) => {
    const member = await model.memberById(ctx.memberId!);
    if (!member || !member.roles.includes('founder')) throw forbidden();
    const rows = await db.query('SELECT state, COUNT(*)::int AS n FROM bookings GROUP BY state');
    const counts: Record<string, number> = {};
    for (const s of ['held', 'requested', 'confirmed', 'completed', 'rated', 'expired', 'declined', 'withdrawn', 'cancelled_by_passenger', 'cancelled_by_driver']) counts[s] = 0;
    for (const r of rows.rows) counts[r.state] = Number(r.n);
    return { status: 200, payload: { counts } };
  }, { member: true, json: false });
}

function isPng(b: Buffer): boolean { return b.length > 8 && PNG_SIG.every((v, i) => b[i] === v); }
function isJpeg(b: Buffer): boolean { return b.length > 3 && JPEG_SIG.every((v, i) => b[i] === v); }

function detect(b: Buffer): string | null {
  if (isPng(b)) return 'image/png';
  if (isJpeg(b)) return 'image/jpeg';
  if (b.length > 4 && PDF_SIG.every((v, i) => b[i] === v)) return 'application/pdf';
  return null;
}
