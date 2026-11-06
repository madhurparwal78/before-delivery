import { Router } from 'express';
import { limits } from '../config.js';
import { many, one, pool, withTransaction, type Queryable } from '../db/pool.js';
import { newId } from '../lib/codes.js';
import {
  conflict,
  notFound,
  payloadTooLarge,
  staleVersion,
  versionRequired,
} from '../lib/errors.js';
import { requireRole, type Caller } from '../http/middleware.js';
import { parseMultipart } from '../http/multipart.js';
import { createSignedLink } from '../http/signed.js';
import {
  asInteger,
  asString,
  asTrimmed,
  ErrorBag,
  expectObject,
  fail,
} from '../http/validate.js';
import { writeAudit } from '../domain/audit.js';
import {
  entryImages,
  listEntries,
  loadEntry,
  loadEntryImage,
  serialiseEntry,
  type EntryRow,
} from '../domain/entries.js';
import {
  listSessions,
  loadEdition,
  loadSession,
  loadSessionForUpdate,
  serialiseSession,
} from '../domain/programme.js';
import { refundCancelledSession } from '../domain/refunds.js';
import {
  isProgrammeState,
  sessionEditable,
  transitionAllowed,
  type ProgrammeState,
} from '../domain/states.js';
import { decodeImage, fileNameAllowed, sniffType } from '../services/images.js';
import { objectKeys, putObject } from '../services/storage.js';
import { renderDisplayCopy } from '../services/images.js';
import { resolveLocalTime } from '../lib/time.js';

export const curateRouter = Router();

interface TransitionRequest {
  to: ProgrammeState;
  note: string | null;
  publishAt: Date | null;
}

function readTransition(raw: unknown): TransitionRequest {
  const body = expectObject(raw);
  const to = asString(body['to']);
  if (to === null || !isProgrammeState(to)) fail('to', 'unknown');
  const note = asTrimmed(body['note']);
  const publishAtText = asTrimmed(body['publish_at']);
  let publishAt: Date | null = null;
  if (to === 'scheduled') {
    if (publishAtText === null) fail('publish_at', 'required');
    const resolved = resolveLocalTime(publishAtText as string);
    if (typeof resolved === 'string') {
      fail('publish_at', resolved === 'invalid' ? 'invalid' : resolved);
    }
    publishAt = (resolved as { instant: Date }).instant;
    if (publishAt.getTime() <= Date.now()) fail('publish_at', 'not_in_future');
  }
  return { to: to as ProgrammeState, note, publishAt };
}

async function sessionHistory(
  db: Queryable,
  sessionId: string,
): Promise<Array<{ from: string | null; to: string; at: string; by: string }>> {
  const rows = await many<{ from_state: string | null; to_state: string; at: Date; actor: string }>(
    db,
    `SELECT from_state, to_state, at, actor FROM session_history WHERE session_id = $1
     ORDER BY at, to_state`,
    [sessionId],
  );
  return rows.map((row) => ({
    from: row.from_state,
    to: row.to_state,
    at: row.at.toISOString().replace(/\.\d{3}Z$/, '.000Z'),
    by: row.actor,
  }));
}

curateRouter.get('/curate/sessions', async (req, res) => {
  requireRole(req, 'curator');
  const status = typeof req.query['status'] === 'string' ? req.query['status'] : null;
  const rows = await listSessions(pool, status === null ? {} : { statuses: [status] });
  res.status(200).json({ sessions: rows.map((row) => serialiseSession(row, true)) });
});

curateRouter.post('/sessions', async (req, res) => {
  const caller = requireRole(req, 'curator');
  const session = await withTransaction(async (tx) => {
    const draft = await readSessionFields(tx, req.body, true);
    const id = `s-${newId()}`;
    await tx.query(
      `INSERT INTO programme_sessions (id, title, description, discipline, venue_id, admission,
         capacity, price_full_cents, price_reduced_cents, starts_at, ends_at, status, version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'draft', 1)`,
      [
        id,
        draft.title,
        draft.description,
        draft.discipline,
        draft.venueId,
        draft.admission,
        draft.capacity,
        draft.priceFull,
        draft.priceReduced,
        draft.startsAt,
        draft.endsAt,
      ],
    );
    await tx.query(
      `INSERT INTO session_history (id, session_id, from_state, to_state, at, actor)
       VALUES ($1, $2, NULL, 'draft', now(), $3)`,
      [newId(), id, caller.email],
    );
    await writeAudit(tx, {
      actor: caller.email,
      actorRole: caller.role,
      action: 'session.created',
      targetType: 'session',
      targetId: id,
      detail: { title: draft.title },
    });
    const row = await loadSession(tx, id);
    if (row === null) throw new Error('session insert failed');
    return row;
  });
  res.status(201).json(serialiseSession(session, true));
});

curateRouter.patch('/sessions/:id', async (req, res) => {
  const caller = requireRole(req, 'curator');
  const session = await withTransaction(async (tx) => {
    const existing = await loadSessionForUpdate(tx, req.params.id);
    if (existing === null) throw notFound();
    const ifMatch = req.headers['if-match'];
    if (typeof ifMatch !== 'string' || ifMatch.trim().length === 0) throw versionRequired();
    const given = Number(ifMatch.replace(/"/g, '').trim());
    if (!Number.isInteger(given)) throw versionRequired();
    if (given !== existing.version) throw staleVersion(existing.version);
    if (!sessionEditable(existing.effective_status)) throw conflict('not_editable');

    const patch = await readSessionFields(tx, req.body, false, existing);
    await tx.query(
      `UPDATE programme_sessions SET title = $2, description = $3, discipline = $4, venue_id = $5,
         admission = $6, capacity = $7, price_full_cents = $8, price_reduced_cents = $9,
         starts_at = $10, ends_at = $11, version = version + 1
       WHERE id = $1`,
      [
        existing.id,
        patch.title,
        patch.description,
        patch.discipline,
        patch.venueId,
        patch.admission,
        patch.capacity,
        patch.priceFull,
        patch.priceReduced,
        patch.startsAt,
        patch.endsAt,
      ],
    );
    await writeAudit(tx, {
      actor: caller.email,
      actorRole: caller.role,
      action: 'session.updated',
      targetType: 'session',
      targetId: existing.id,
      detail: { version: existing.version + 1 },
    });
    const row = await loadSession(tx, existing.id);
    if (row === null) throw new Error('session vanished');
    return row;
  });
  res.status(200).json(serialiseSession(session, true));
});

interface SessionFields {
  title: string;
  description: string;
  discipline: string;
  venueId: string;
  admission: 'pass' | 'seat';
  capacity: number | null;
  priceFull: number | null;
  priceReduced: number | null;
  startsAt: Date;
  endsAt: Date;
}

async function readSessionFields(
  db: Queryable,
  raw: unknown,
  creating: boolean,
  existing?: {
    title: string;
    description: string;
    discipline: string;
    venue_id: string;
    admission: 'pass' | 'seat';
    capacity: number | null;
    price_full_cents: number | null;
    price_reduced_cents: number | null;
    starts_at: Date;
    ends_at: Date;
  },
): Promise<SessionFields> {
  const body = expectObject(raw);
  const bag = new ErrorBag();
  const has = (field: string): boolean => Object.hasOwn(body, field);

  const title = has('title') ? asTrimmed(body['title']) : (existing?.title ?? null);
  if (title === null) bag.add('title', 'required');
  const description = has('description')
    ? (asString(body['description']) ?? '')
    : (existing?.description ?? '');

  const discipline = has('discipline')
    ? asTrimmed(body['discipline'])
    : (existing?.discipline ?? null);
  if (discipline === null) bag.add('discipline', 'required');
  else {
    const known = await one<{ id: string }>(db, `SELECT id FROM disciplines WHERE id = $1`, [
      discipline,
    ]);
    if (known === null) bag.add('discipline', 'unknown');
  }

  const venueId = has('venue_id') ? asTrimmed(body['venue_id']) : (existing?.venue_id ?? null);
  if (venueId === null) bag.add('venue_id', 'required');
  else {
    const known = await one<{ id: string }>(db, `SELECT id FROM venues WHERE id = $1`, [venueId]);
    if (known === null) bag.add('venue_id', 'unknown');
  }

  const admissionText = has('admission')
    ? asTrimmed(body['admission'])
    : (existing?.admission ?? null);
  if (admissionText !== 'pass' && admissionText !== 'seat') bag.add('admission', 'unknown');

  const edition = await loadEdition(db);
  const startsText = has('starts_local') ? asTrimmed(body['starts_local']) : null;
  const endsText = has('ends_local') ? asTrimmed(body['ends_local']) : null;

  let startsAt = existing?.starts_at ?? null;
  if (startsText !== null) {
    const resolved = resolveLocalTime(startsText);
    if (typeof resolved === 'string') bag.add('starts_local', resolved);
    else startsAt = resolved.instant;
  } else if (creating) {
    bag.add('starts_local', 'invalid');
  }

  let endsAt = existing?.ends_at ?? null;
  if (endsText !== null) {
    const resolved = resolveLocalTime(endsText);
    if (typeof resolved === 'string') bag.add('ends_local', resolved);
    else endsAt = resolved.instant;
  } else if (creating) {
    bag.add('ends_local', 'invalid');
  }

  if (startsAt !== null) {
    const day = startsAt.toISOString().slice(0, 10);
    const firstStart = Date.parse(`${edition.first_day}T00:00:00Z`) - 86_400_000;
    const lastEnd = Date.parse(`${edition.last_day}T23:59:59Z`) + 86_400_000;
    const at = Date.parse(`${day}T00:00:00Z`);
    if (at < firstStart || at > lastEnd) bag.add('starts_local', 'outside_edition');
  }
  if (startsAt !== null && endsAt !== null && endsAt.getTime() <= startsAt.getTime()) {
    bag.add('ends_local', 'ends_before_start');
  }

  const seated = admissionText === 'seat';
  const capacity = has('capacity') ? asInteger(body['capacity']) : (existing?.capacity ?? null);
  if (seated) {
    if (capacity === null) bag.add('capacity', 'required');
    else if (capacity < 1 || capacity > 500) bag.add('capacity', 'out_of_range');
  }

  const priceFull = has('price_full_cents')
    ? asInteger(body['price_full_cents'])
    : (existing?.price_full_cents ?? null);
  const priceReduced = has('price_reduced_cents')
    ? asInteger(body['price_reduced_cents'])
    : (existing?.price_reduced_cents ?? null);
  if (seated) {
    if (priceFull === null) bag.add('price_full_cents', 'required');
    if (priceReduced === null) bag.add('price_reduced_cents', 'required');
  }

  bag.throwIfAny();

  return {
    title: title as string,
    description,
    discipline: discipline as string,
    venueId: venueId as string,
    admission: admissionText as 'pass' | 'seat',
    capacity: seated ? capacity : null,
    priceFull: seated ? priceFull : null,
    priceReduced: seated ? priceReduced : null,
    startsAt: startsAt as Date,
    endsAt: endsAt as Date,
  };
}

curateRouter.post('/sessions/:id/transitions', async (req, res) => {
  const caller = requireRole(req, 'curator');
  const outcome = await withTransaction(async (tx) => {
    const session = await loadSessionForUpdate(tx, req.params.id);
    if (session === null) throw notFound();
    const request = readTransition(req.body);
    const from = session.effective_status;
    if (!transitionAllowed(from, request.to, 'curator')) {
      throw conflict('illegal_transition', { from, to: request.to });
    }

    await tx.query(
      `UPDATE programme_sessions SET status = $2, publish_at = $3, version = version + 1
       WHERE id = $1`,
      [session.id, request.to, request.to === 'scheduled' ? request.publishAt : null],
    );
    await tx.query(
      `INSERT INTO session_history (id, session_id, from_state, to_state, at, actor, note)
       VALUES ($1, $2, $3, $4, now(), $5, $6)`,
      [newId(), session.id, from, request.to, caller.email, request.note],
    );
    await writeAudit(tx, {
      actor: caller.email,
      actorRole: caller.role,
      action: `session.${request.to}`,
      targetType: 'session',
      targetId: session.id,
      detail: { from, to: request.to },
    });

    let refundsStarted = 0;
    if (request.to === 'cancelled') {
      refundsStarted = await refundCancelledSession(tx, session.id, caller.email);
    }

    const updated = await loadSession(tx, session.id);
    if (updated === null) throw new Error('session vanished');
    return {
      session: serialiseSession(updated, true),
      history: await sessionHistory(tx, session.id),
      refunds_started: refundsStarted,
    };
  });
  res.status(200).json(outcome);
});

curateRouter.get('/sessions/:id/history', async (req, res) => {
  requireRole(req, 'curator');
  const session = await loadSession(pool, req.params.id);
  if (session === null) throw notFound();
  res.status(200).json({ history: await sessionHistory(pool, session.id) });
});

/** An entry is visible to its artist and to curators. */
async function visibleEntry(caller: Caller, id: string): Promise<EntryRow> {
  const entry = await loadEntry(pool, id);
  if (entry === null) throw notFound();
  if (caller.role === 'curator') return entry;
  if (caller.role === 'artist' && entry.artist_id === caller.id) return entry;
  throw notFound();
}

curateRouter.get('/entries', async (req, res) => {
  const caller = requireRole(req, 'artist', 'curator');
  const rows =
    caller.role === 'curator'
      ? await listEntries(pool, {})
      : await listEntries(pool, { artistId: caller.id });
  const entries = [];
  for (const row of rows) {
    entries.push(await serialiseEntry(pool, row));
  }
  res.status(200).json({ entries });
});

curateRouter.post('/entries', async (req, res) => {
  const caller = requireRole(req, 'artist');
  const body = expectObject(req.body);
  const bag = new ErrorBag();
  const title = asTrimmed(body['title']);
  const statement = asString(body['statement']) ?? '';
  const discipline = asTrimmed(body['discipline']);
  const medium = asString(body['medium']) ?? '';
  const year = asString(body['year']) ?? '';
  if (title === null || title.length > 200) bag.add('title', 'required');
  if (discipline === null) bag.add('discipline', 'required');
  bag.throwIfAny();
  const known = await one<{ id: string }>(pool, `SELECT id FROM disciplines WHERE id = $1`, [
    discipline,
  ]);
  if (known === null) fail('discipline', 'unknown');

  const id = `e-${newId()}`;
  const entry = await withTransaction(async (tx) => {
    await tx.query(
      `INSERT INTO entries (id, artist_id, title, statement, discipline, medium, year, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft')`,
      [id, caller.id, title, statement, discipline, medium, year],
    );
    await tx.query(
      `INSERT INTO entry_history (id, entry_id, from_state, to_state, at, actor)
       VALUES ($1, $2, NULL, 'draft', now(), $3)`,
      [newId(), id, caller.email],
    );
    const row = await loadEntry(tx, id);
    if (row === null) throw new Error('entry insert failed');
    return row;
  });
  res.status(201).json(await serialiseEntry(pool, entry));
});

curateRouter.get('/entries/:id', async (req, res) => {
  const caller = requireRole(req, 'artist', 'curator');
  const entry = await visibleEntry(caller, req.params.id);
  res.status(200).json(await serialiseEntry(pool, entry));
});

curateRouter.patch('/entries/:id', async (req, res) => {
  const caller = requireRole(req, 'artist');
  const entry = await visibleEntry(caller, req.params.id);
  if (entry.artist_id !== caller.id) throw notFound();
  if (entry.effective_status !== 'draft') throw conflict('not_editable');
  const body = expectObject(req.body);
  const has = (field: string): boolean => Object.hasOwn(body, field);

  const title = has('title') ? asTrimmed(body['title']) : entry.title;
  if (title === null) fail('title', 'required');
  const discipline = has('discipline') ? asTrimmed(body['discipline']) : entry.discipline;
  if (discipline === null) fail('discipline', 'required');
  const known = await one<{ id: string }>(pool, `SELECT id FROM disciplines WHERE id = $1`, [
    discipline,
  ]);
  if (known === null) fail('discipline', 'unknown');

  await pool.query(
    `UPDATE entries SET title = $2, statement = $3, discipline = $4, medium = $5, year = $6
     WHERE id = $1`,
    [
      entry.id,
      title,
      has('statement') ? (asString(body['statement']) ?? '') : entry.statement,
      discipline,
      has('medium') ? (asString(body['medium']) ?? '') : entry.medium,
      has('year') ? (asString(body['year']) ?? '') : entry.year,
    ],
  );
  const updated = await loadEntry(pool, entry.id);
  if (updated === null) throw notFound();
  res.status(200).json(await serialiseEntry(pool, updated));
});

curateRouter.post('/entries/:id/images', async (req, res) => {
  const caller = requireRole(req, 'artist');
  const entry = await visibleEntry(caller, req.params.id);
  if (entry.artist_id !== caller.id) throw notFound();
  if (entry.effective_status !== 'draft') throw conflict('not_editable');

  const multipart = parseMultipart(req.rawBody, req.headers['content-type'] ?? '');
  const file = multipart.files.find((candidate) => candidate.fieldName === 'file');
  if (file === undefined) fail('file', 'required');
  if (file.bytes.byteLength === 0) fail('file', 'empty');
  if (file.bytes.byteLength > limits.artworkBytes) throw payloadTooLarge();
  if (!fileNameAllowed(file.filename)) fail('file', 'invalid_name');

  const sniffed = sniffType(file.bytes);
  if (sniffed === null || sniffed === 'application/pdf') fail('file', 'unsupported_type');
  const decoded = await decodeImage(file.bytes, sniffed);
  if (decoded === null) fail('file', 'unsupported_type');

  const imageId = newId();
  const originalKey = objectKeys.artworkOriginal(entry.id, imageId);
  const displayKey = objectKeys.artworkDisplay(entry.id, imageId);
  await putObject(originalKey, file.bytes, sniffed);
  await putObject(displayKey, renderDisplayCopy(decoded), 'image/jpeg');
  await pool.query(
    `INSERT INTO entry_images (id, entry_id, width, height, original_key, display_key,
       content_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [imageId, entry.id, decoded.width, decoded.height, originalKey, displayKey, sniffed],
  );
  res.status(201).json({
    image: { id: imageId, width: decoded.width, height: decoded.height, display_url: null },
  });
});

curateRouter.post('/entries/:id/images/:imageId/read', async (req, res) => {
  const caller = requireRole(req, 'artist', 'curator');
  const entry = await visibleEntry(caller, req.params.id);
  const image = await loadEntryImage(pool, req.params.imageId);
  if (image === null || image.entry_id !== entry.id) throw notFound();
  res.status(200).json(await createSignedLink(image.original_key));
});

curateRouter.post('/entries/:id/transitions', async (req, res) => {
  const caller = requireRole(req, 'artist', 'curator');
  const entry = await visibleEntry(caller, req.params.id);
  const request = readTransition(req.body);
  const from = entry.effective_status;
  const actorKind = caller.role === 'curator' ? 'curator' : 'artist';
  if (!transitionAllowed(from, request.to, actorKind)) {
    throw conflict('illegal_transition', { from, to: request.to });
  }
  if (request.to === 'review' && (await entryImages(pool, entry.id)).length === 0) {
    fail('images', 'required');
  }

  const outcome = await withTransaction(async (tx) => {
    await tx.query(`UPDATE entries SET status = $2, publish_at = $3 WHERE id = $1`, [
      entry.id,
      request.to,
      request.to === 'scheduled' ? request.publishAt : null,
    ]);
    await tx.query(
      `INSERT INTO entry_history (id, entry_id, from_state, to_state, at, actor, note)
       VALUES ($1, $2, $3, $4, now(), $5, $6)`,
      [newId(), entry.id, from, request.to, caller.email, request.note],
    );
    await writeAudit(tx, {
      actor: caller.email,
      actorRole: caller.role,
      action: `entry.${request.to}`,
      targetType: 'entry',
      targetId: entry.id,
      detail: { from, to: request.to },
    });
    const updated = await loadEntry(tx, entry.id);
    if (updated === null) throw new Error('entry vanished');
    const history = await many<{
      from_state: string | null;
      to_state: string;
      at: Date;
      actor: string;
    }>(
      tx,
      `SELECT from_state, to_state, at, actor FROM entry_history WHERE entry_id = $1
       ORDER BY at, to_state`,
      [entry.id],
    );
    return {
      entry: await serialiseEntry(tx, updated),
      history: history.map((row) => ({
        from: row.from_state,
        to: row.to_state,
        at: row.at.toISOString().replace(/\.\d{3}Z$/, '.000Z'),
        by: row.actor,
      })),
    };
  });
  res.status(200).json(outcome);
});
