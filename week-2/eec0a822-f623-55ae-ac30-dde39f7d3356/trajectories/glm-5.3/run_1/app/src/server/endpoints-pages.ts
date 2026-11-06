import type { App } from './api.js';
import type { Ctx } from './http.js';
import { ApiError, fieldErrors, notFound, pageEnded, rateLimited, stateConflict, serviceUnavailable } from './errors.js';
import { isRecord, str, whole, bool, lengthOf } from './validate.js';
import { holdQuery, holdToApi, type HoldRow } from './holds.js';
import { placeHold, weeksFor, yachtProfile, crewFor, getYacht, rateFor, seasonOf, newId, exchangeTableFor } from './endpoints-holds.js';
import { parseMultipart, readRawBody, randomToken } from './http.js';
import { putObject, getObjectBytes, deleteObject, StorageUnavailable } from './minio.js';
import { sendMail } from './mail.js';
import { parseImage } from './photos.js';
import * as base from '../shared/bases.js';
import { fmtDateOnly, fmtDateTime } from '../shared/bases.js';
import type { YachtDb } from './endpoints-holds.js';

const PHOTO_LIMIT = 5000000;
const ENVELOPE = 100000;

// ---------------- guest manifest ----------------

export async function charterManifest(app: App, ctx: Ctx, ws: string, charterId: string): Promise<unknown> {
  const member = await app.requireStaff(ctx, ws, ['fleet_director', 'charter_manager', 'captain']);
  const charterRows = await app.pool.query('SELECT * FROM charters WHERE id = $1 AND workspace_slug = $2', [charterId, ws]);
  const charter = charterRows.rows[0];
  if (!charter) throw notFound();
  const pageRows = await app.pool.query(
    'SELECT status, issued_at, ends_at, token FROM private_pages WHERE kind = $1 AND charter_id = $2 ORDER BY issued_at DESC LIMIT 1',
    ['manifest', charterId],
  );
  const page = pageRows.rows[0];
  const maySeePath = member.role === 'charter_manager' || member.role === 'fleet_director';
  const pageOut = page
    ? { status: page.status, issuedAt: base.instToIso({ ms: page.issued_at.getTime() }), endsAt: base.instToIso({ ms: page.ends_at.getTime() }), path: maySeePath ? `/m/${page.token}` : null }
    : { status: 'none', issuedAt: null, endsAt: null, path: null };
  const guests = await app.pool.query('SELECT id, full_name, nationality, date_of_birth, passport_number, photo_key FROM guests WHERE charter_id = $1 ORDER BY sort_order, created_at', [charterId]);
  const guestOut = guests.rows.map((g) => {
    if (member.role === 'charter_manager') {
      return { id: g.id, fullName: g.full_name };
    }
    return {
      id: g.id,
      fullName: g.full_name,
      nationality: g.nationality,
      dateOfBirth: g.date_of_birth ?? null,
      passportNumber: g.passport_number,
      photo: g.photo_key ? true : null,
    };
  });
  return { page: pageOut, guests: guestOut };
}

export async function manifestPageSend(app: App, ctx: Ctx, ws: string, charterId: string): Promise<unknown> {
  const member = await app.requireStaff(ctx, ws, ['fleet_director', 'charter_manager']);
  const body = await app.readJsonBody(ctx);
  const leadGuestName = str(body.leadGuestName) ?? '';
  const leadGuestEmail = str(body.leadGuestEmail) ?? '';
  const errors: Record<string, string> = {};
  if (lengthOf(leadGuestName) < 1 || lengthOf(leadGuestName) > 80) errors.leadGuestName = 'This field is required.';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(leadGuestEmail)) errors.leadGuestEmail = 'Enter an email address like name@example.com.';
  if (Object.keys(errors).length > 0) throw fieldErrors(errors);
  const charterRows = await app.pool.query('SELECT * FROM charters WHERE id = $1 AND workspace_slug = $2', [charterId, ws]);
  const charter = charterRows.rows[0];
  if (!charter) throw notFound();
  if (charter.status === 'closed') throw stateConflict('charter_closed');
  const yachtRows = await app.pool.query<YachtDb>('SELECT * FROM yachts WHERE slug = $1', [charter.yacht_slug]);
  const yacht = yachtRows.rows[0];
  const client = await app.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("UPDATE private_pages SET status = 'ended' WHERE kind = 'manifest' AND charter_id = $1 AND status = 'live'", [charterId]);
    const token = randomToken(32);
    await client.query(
      "INSERT INTO private_pages (token, kind, workspace_slug, charter_id, status, issued_at, ends_at) VALUES ($1,'manifest',$2,$3,'live',now(),now() + make_interval(secs => $4))",
      [token, ws, charterId, app.config.timers.manifestPageSeconds],
    );
    await client.query('COMMIT');
    const endsAt = new Date(Date.now() + app.config.timers.manifestPageSeconds * 1000);
    await sendMail(app.config, {
      to: leadGuestEmail,
      subject: `Guest manifest for ${yacht.name}, week of ${fmtDateOnly('split', charter.week_start)}`,
      body: `Dear ${leadGuestName},\n\nComplete the guest manifest for your charter of ${yacht.name}.\n\n${app.config.publicUrl}/m/${token}\n\nThis link works until ${fmtDateTime('split', { ms: endsAt.getTime() })}.`,
    });
    return {
      page: {
        status: 'live',
        issuedAt: base.instToIso({ ms: Date.now() }),
        endsAt: base.instToIso({ ms: endsAt.getTime() }),
        path: `/m/${token}`,
      },
    };
  } finally {
    client.release();
  }
}

export async function manifestPageEnd(app: App, ctx: Ctx, ws: string, charterId: string): Promise<unknown> {
  await app.requireStaff(ctx, ws, ['fleet_director', 'charter_manager']);
  const rows = await app.pool.query('SELECT * FROM private_pages WHERE kind = $1 AND charter_id = $2 AND status = $3', ['manifest', charterId, 'live']);
  const page = rows.rows[0];
  if (!page) throw stateConflict('page_not_live');
  await app.pool.query("UPDATE private_pages SET status = 'ended' WHERE token = $1", [page.token]);
  return { page: { status: 'ended', issuedAt: base.instToIso({ ms: page.issued_at.getTime() }), endsAt: base.instToIso({ ms: page.ends_at.getTime() }) } };
}

interface ManifestPageInfo {
  token: string;
  charter: any;
  yacht: YachtDb;
  workspaceName: string;
}

async function manifestPageByToken(app: App, token: string): Promise<ManifestPageInfo> {
  const rows = await app.pool.query(
    `SELECT p.*, c.id AS charter_id, c.yacht_slug, c.week_start, c.week_end, c.status AS charter_status
     FROM private_pages p JOIN charters c ON c.id = p.charter_id WHERE p.token = $1 AND p.kind = 'manifest'`,
    [token],
  );
  const page = rows.rows[0];
  if (!page) throw notFound();
  if (page.status === 'ended' || page.ends_at.getTime() <= Date.now() || page.charter_status === 'closed') {
    throw pageEnded();
  }
  const yachtRows = await app.pool.query<YachtDb>('SELECT * FROM yachts WHERE slug = $1', [page.yacht_slug]);
  const wsRows = await app.pool.query('SELECT name FROM workspaces WHERE slug = $1', [page.workspace_slug]);
  return { token, charter: page, yacht: yachtRows.rows[0], workspaceName: wsRows.rows[0].name };
}

export async function manifestGet(app: App, ctx: Ctx, token: string): Promise<unknown> {
  const info = await manifestPageByToken(app, token);
  const guests = await app.pool.query('SELECT id, full_name, nationality, date_of_birth, passport_number, photo_key FROM guests WHERE charter_id = $1 ORDER BY sort_order, created_at', [info.charter.charter_id]);
  return {
    yachtName: info.yacht.name,
    weekStart: info.charter.week_start,
    weekEnd: info.charter.week_end,
    maxGuests: info.yacht.cabins * 2,
    status: 'live',
    endsAt: base.instToIso({ ms: info.charter.ends_at.getTime() }),
    guests: guests.rows.map((g) => ({
      id: g.id,
      fullName: g.full_name,
      nationality: g.nationality,
      passportOnFile: g.passport_number !== null,
      dateOfBirthOnFile: g.date_of_birth !== null,
      photoOnFile: g.photo_key !== null,
    })),
  };
}

export async function manifestAddGuest(app: App, ctx: Ctx, token: string): Promise<unknown> {
  const info = await manifestPageByToken(app, token);
  const body = await app.readJsonBody(ctx);
  const fullName = str(body.fullName) ?? '';
  if (lengthOf(fullName) < 1 || lengthOf(fullName) > 80) throw fieldErrors({ fullName: 'This field is required.' });
  const count = await app.pool.query('SELECT count(*)::int AS n FROM guests WHERE charter_id = $1', [info.charter.charter_id]);
  if (count.rows[0].n >= info.yacht.cabins * 2) throw stateConflict('manifest_full', { maxGuests: info.yacht.cabins * 2 });
  const id = newId('guest');
  const order = count.rows[0].n + 1;
  await app.pool.query('INSERT INTO guests (id, charter_id, full_name, sort_order) VALUES ($1,$2,$3,$4)', [id, info.charter.charter_id, fullName, order]);
  return { guest: { id, fullName, nationality: null, passportOnFile: false, dateOfBirthOnFile: false, photoOnFile: false } };
}

const COUNTRY_CODES = new Set(['GB', 'HR', 'GR', 'DE', 'US', 'FR', 'IT', 'ES', 'AT', 'AU', 'BE', 'BR', 'CA', 'CH', 'CN', 'CZ', 'DK', 'FI', 'JP', 'NL', 'NO', 'NZ', 'PL', 'PT', 'SE', 'TR', 'UA', 'IE', 'IS', 'LU', 'MT', 'CY', 'EE', 'LV', 'LT', 'SK', 'SI', 'HU', 'RO', 'BG', 'RS', 'MX', 'AR', 'ZA', 'IN', 'KR', 'SG', 'HK', 'AE', 'IL', 'EG', 'MA', 'TN', 'OTHER']);

export async function manifestPutGuests(app: App, ctx: Ctx, token: string): Promise<unknown> {
  const info = await manifestPageByToken(app, token);
  const body = await app.readJsonBody(ctx);
  const guestsIn = Array.isArray(body.guests) ? body.guests : null;
  if (!guestsIn) throw fieldErrors({ guests: 'This field is required.' });
  const existing = await app.pool.query('SELECT id, full_name, nationality, date_of_birth, passport_number, photo_key FROM guests WHERE charter_id = $1 ORDER BY sort_order, created_at', [info.charter.charter_id]);
  const byId = new Map(existing.rows.map((g) => [g.id, g]));
  const errors: Record<string, string> = {};
  const splitToday = base.localDate('split', { ms: Date.now() });
  const updates: Array<{ id: string; fullName: string; nationality: string | null; dateOfBirth: string | null; passportNumber: string | null }> = [];
  guestsIn.forEach((raw, i) => {
    if (!isRecord(raw)) return;
    const id = str(raw.id) ?? '';
    const existingGuest = byId.get(id);
    if (!existingGuest) throw notFound();
    const fullName = str(raw.fullName) ?? existingGuest.full_name;
    const nationality = str(raw.nationality);
    const dob = str(raw.dateOfBirth);
    const passport = str(raw.passportNumber);
    if (nationality === null || !/^[A-Z]{2}$/.test(nationality)) errors[`guests.${i}.nationality`] = 'Choose one of the listed options.';
    if (dob !== undefined && dob !== null && dob !== '') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || dob >= splitToday || yearGap(dob, splitToday) > 120) errors[`guests.${i}.dateOfBirth`] = 'Enter a date of birth in the past.';
    }
    if (passport !== undefined && passport !== null && passport !== '') {
      if (!/^[A-Z0-9]{5,20}$/.test(passport)) errors[`guests.${i}.passportNumber`] = 'Enter 5 to 20 capital letters or digits.';
    }
    if (!passport && !existingGuest.passport_number) errors[`guests.${i}.passportNumber`] = 'This field is required.';
    if (!dob && !existingGuest.date_of_birth) errors[`guests.${i}.dateOfBirth`] = 'This field is required.';
    updates.push({
      id,
      fullName,
      nationality: nationality ?? null,
      dateOfBirth: (dob || existingGuest.date_of_birth) ?? null,
      passportNumber: passport || (existingGuest.passport_number ?? null),
    });
  });
  if (Object.keys(errors).length > 0) throw fieldErrors(errors);
  const client = await app.pool.connect();
  try {
    await client.query('BEGIN');
    for (const u of updates) {
      await client.query('UPDATE guests SET full_name = $1, nationality = $2, date_of_birth = $3, passport_number = $4 WHERE id = $5', [u.fullName, u.nationality, u.dateOfBirth, u.passportNumber, u.id]);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  const fresh = await app.pool.query('SELECT id, full_name, nationality, date_of_birth, passport_number, photo_key FROM guests WHERE charter_id = $1 ORDER BY sort_order, created_at', [info.charter.charter_id]);
  return {
    guests: fresh.rows.map((g) => ({
      id: g.id,
      fullName: g.full_name,
      nationality: g.nationality,
      passportOnFile: g.passport_number !== null,
      dateOfBirthOnFile: g.date_of_birth !== null,
      photoOnFile: g.photo_key !== null,
    })),
  };
}

function yearGap(dob: string, today: string): number {
  return Number(today.slice(0, 4)) - Number(dob.slice(0, 4));
}

export async function manifestDeleteGuest(app: App, ctx: Ctx, token: string, guestId: string): Promise<unknown> {
  const info = await manifestPageByToken(app, token);
  const rows = await app.pool.query('SELECT id, photo_key FROM guests WHERE id = $1 AND charter_id = $2', [guestId, info.charter.charter_id]);
  const guest = rows.rows[0];
  if (!guest) throw notFound();
  if (guest.photo_key) {
    try {
      await deleteObject(app.config, guest.photo_key);
    } catch {
      // best effort; the row delete below still proceeds
    }
  }
  await app.pool.query('DELETE FROM guests WHERE id = $1', [guestId]);
  return null;
}

export async function manifestUploadPhoto(app: App, ctx: Ctx, token: string, guestId: string): Promise<unknown> {
  const info = await manifestPageByToken(app, token);
  const guestRows = await app.pool.query('SELECT id, full_name, photo_key, photo_type FROM guests WHERE id = $1 AND charter_id = $2', [guestId, info.charter.charter_id]);
  const guest = guestRows.rows[0];
  if (!guest) throw notFound();
  const contentType = (ctx.req.headers['content-type'] ?? '').split(';')[0].trim();
  if (ctx.method !== 'POST' || contentType !== 'multipart/form-data') throw new ApiError(415, { error: 'unsupported_media_type' });
  const raw = await readRawBody(ctx.req, PHOTO_LIMIT + ENVELOPE);
  if (!raw.ok) throw new ApiError(413, { error: 'too_large', limitBytes: PHOTO_LIMIT });
  const boundary = /boundary=(.+)$/.exec(ctx.req.headers['content-type'] ?? '')?.[1] ?? '';
  const parts = parseMultipart(raw.body!, boundary);
  const part = parts.find((p) => p.name === 'photo');
  if (!part || part.body.length > PHOTO_LIMIT) throw new ApiError(413, { error: 'too_large', limitBytes: PHOTO_LIMIT });
  const image = parseImage(part.body);
  if (!image) throw fieldErrors({ photo: 'Choose a JPEG or PNG photo.' });
  const key = `passport-photos/${info.charter.charter_id}/${guestId}.${image.type === 'jpeg' ? 'jpg' : 'png'}`;
  try {
    await putObject(app.config, key, image.bytes, image.type === 'jpeg' ? 'image/jpeg' : 'image/png');
  } catch (e) {
    if (e instanceof StorageUnavailable) throw serviceUnavailable('storage_unavailable');
    throw e;
  }
  await app.pool.query('UPDATE guests SET photo_key = $1, photo_type = $2 WHERE id = $3', [key, image.type, guestId]);
  return {
    guest: {
      id: guestId,
      fullName: guest.full_name,
      nationality: null,
      passportOnFile: (await app.pool.query('SELECT passport_number IS NOT NULL AS b FROM guests WHERE id = $1', [guestId])).rows[0].b,
      dateOfBirthOnFile: (await app.pool.query('SELECT date_of_birth IS NOT NULL AS b FROM guests WHERE id = $1', [guestId])).rows[0].b,
      photoOnFile: true,
    },
  };
}

export async function guestPhoto(app: App, ctx: Ctx, ws: string, charterId: string, guestId: string): Promise<unknown> {
  await app.requireStaff(ctx, ws, ['fleet_director', 'captain']);
  const guestRows = await app.pool.query('SELECT photo_key, photo_type FROM guests WHERE id = $1 AND charter_id = $2', [guestId, charterId]);
  const guest = guestRows.rows[0];
  if (!guest || !guest.photo_key) throw notFound();
  const obj = await getObjectBytes(app.config, guest.photo_key);
  if (!obj.body) throw notFound();
  const res = ctx.res;
  res.writeHead(200, { 'Content-Type': guest.photo_type === 'jpeg' ? 'image/jpeg' : 'image/png', 'Content-Length': obj.body.length, 'Cache-Control': 'private, no-store' });
  res.end(obj.body);
  return undefined;
}

// ---------------- brokers ----------------

export async function brokersList(app: App, ctx: Ctx, ws: string): Promise<unknown> {
  await app.requireStaff(ctx, ws, ['fleet_director', 'charter_manager']);
  const rows = await app.pool.query('SELECT * FROM brokers WHERE workspace_slug = $1 ORDER BY name', [ws]);
  const out = [];
  for (const b of rows.rows) {
    const page = await app.pool.query('SELECT status, issued_at, ends_at FROM private_pages WHERE kind = $1 AND broker_id = $2 ORDER BY issued_at DESC LIMIT 1', ['broker', b.id]);
    const p = page.rows[0];
    out.push({
      id: b.id,
      name: b.name,
      contactName: b.contact_name,
      email: b.email,
      notes: b.notes,
      page: p ? { status: p.status, issuedAt: base.instToIso({ ms: p.issued_at.getTime() }), endsAt: base.instToIso({ ms: p.ends_at.getTime() }) } : { status: 'none', issuedAt: null, endsAt: null },
    });
  }
  return { brokers: out };
}

export async function brokerPageIssue(app: App, ctx: Ctx, ws: string, brokerId: string): Promise<unknown> {
  await app.requireStaff(ctx, ws, ['fleet_director', 'charter_manager']);
  const brokerRows = await app.pool.query('SELECT * FROM brokers WHERE id = $1 AND workspace_slug = $2', [brokerId, ws]);
  const broker = brokerRows.rows[0];
  if (!broker) throw notFound();
  const wsRows = await app.pool.query('SELECT name FROM workspaces WHERE slug = $1', [ws]);
  const client = await app.pool.connect();
  let token: string;
  try {
    await client.query('BEGIN');
    await client.query("UPDATE private_pages SET status = 'ended' WHERE kind = 'broker' AND broker_id = $1 AND status = 'live'", [brokerId]);
    token = randomToken(32);
    await client.query(
      "INSERT INTO private_pages (token, kind, workspace_slug, broker_id, status, issued_at, ends_at) VALUES ($1,'broker',$2,$3,'live',now(),now() + make_interval(secs => $4))",
      [token, ws, brokerId, app.config.timers.brokerPageSeconds],
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  const endsAt = new Date(Date.now() + app.config.timers.brokerPageSeconds * 1000);
  await sendMail(app.config, {
    to: broker.email,
    subject: `Your ${wsRows.rows[0].name} broker page`,
    body: `Dear ${broker.contact_name},\n\nSee ${wsRows.rows[0].name}'s yachts, weeks and rates.\n\n${app.config.publicUrl}/b/${token}\n\nThis link works until ${fmtDateTime('split', { ms: endsAt.getTime() })}.`,
  });
  return { page: { status: 'live', issuedAt: base.instToIso({ ms: Date.now() }), endsAt: base.instToIso({ ms: endsAt.getTime() }), path: `/b/${token}` } };
}

export async function brokerPageEnd(app: App, ctx: Ctx, ws: string, brokerId: string): Promise<unknown> {
  await app.requireStaff(ctx, ws, ['fleet_director', 'charter_manager']);
  const rows = await app.pool.query("SELECT * FROM private_pages WHERE kind = 'broker' AND broker_id = $1 AND status = 'live'", [brokerId]);
  const page = rows.rows[0];
  if (!page) throw stateConflict('page_not_live');
  await app.pool.query("UPDATE private_pages SET status = 'ended' WHERE token = $1", [page.token]);
  return { page: { status: 'ended', issuedAt: base.instToIso({ ms: page.issued_at.getTime() }), endsAt: base.instToIso({ ms: page.ends_at.getTime() }) } };
}

interface BrokerPageInfo {
  token: string;
  broker: { id: string; name: string; contactName: string; email: string; notes: string };
  workspaceName: string;
  workspaceSlug: string;
}

async function brokerPageByToken(app: App, token: string): Promise<BrokerPageInfo> {
  const rows = await app.pool.query(
    `SELECT p.*, b.id AS broker_id, b.name AS broker_name, b.contact_name, b.email, b.notes, w.name AS ws_name
     FROM private_pages p JOIN brokers b ON b.id = p.broker_id JOIN workspaces w ON w.slug = p.workspace_slug
     WHERE p.token = $1 AND p.kind = 'broker'`,
    [token],
  );
  const page = rows.rows[0];
  if (!page) throw notFound();
  if (page.status === 'ended' || page.ends_at.getTime() <= Date.now()) throw pageEnded();
  return {
    token,
    broker: { id: page.broker_id, name: page.broker_name, contactName: page.contact_name, email: page.email, notes: page.notes },
    workspaceName: page.ws_name,
    workspaceSlug: page.workspace_slug,
  };
}

export async function brokerGet(app: App, ctx: Ctx, token: string): Promise<unknown> {
  const info = await brokerPageByToken(app, token);
  const yachtsRows = await app.pool.query<YachtDb>("SELECT * FROM yachts WHERE workspace_slug = $1 AND status = 'on_sale' ORDER BY name", [info.workspaceSlug]);
  const yachts = [];
  for (const y of yachtsRows.rows) {
    const weeks = await weeksFor(app, y);
    yachts.push({
      slug: y.slug,
      name: y.name,
      base: y.base,
      cabins: y.cabins,
      lengthM: Number(y.length_m),
      weeks: weeks.map((w) => ({ weekStart: w.weekStart, weekEnd: base.addDays(w.weekStart, 7), status: w.status, weeklyRateMinor: w.weeklyRateMinor, currency: 'EUR' })),
    });
  }
  const holdsRows = await app.pool.query<HoldRow>(holdQuery("WHERE broker_id = $1 ORDER BY placed_at DESC"), [info.broker.id]);
  return {
    broker: { name: info.broker.name },
    company: { name: info.workspaceName },
    status: 'live',
    endsAt: base.instToIso({ ms: (await app.pool.query('SELECT ends_at FROM private_pages WHERE token = $1', [token])).rows[0].ends_at.getTime() }),
    yachts,
    holds: holdsRows.rows.map((h) => ({ id: h.id, yachtSlug: h.yacht_slug, weekStart: h.week_start, clientName: h.client_name, status: h.status, position: h.position, lapsesAt: h.lapses_at ? base.instToIso({ ms: h.lapses_at.getTime() }) : null })),
  };
}

export async function brokerPlaceHold(app: App, ctx: Ctx, token: string): Promise<unknown> {
  // Rate limit first, whatever the token state.
  const window = app.config.timers.brokerRateWindowSeconds;
  const cutoff = new Date(Date.now() - window * 1000);
  await app.pool.query('DELETE FROM broker_rate_events WHERE at < $1', [cutoff]);
  const count = await app.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM broker_rate_events WHERE token = $1', [token]);
  const alreadyCounted = count.rows[0].n;
  const counted = await app.pool.query<{ at: Date }>('SELECT at FROM broker_rate_events WHERE token = $1 ORDER BY at ASC', [token]);
  if (alreadyCounted >= 5) {
    const oldest = counted.rows[0].at;
    const retryAfter = Math.ceil((oldest.getTime() + window * 1000 - Date.now()) / 1000);
    throw rateLimited(Math.max(1, retryAfter));
  }
  await app.pool.query('INSERT INTO broker_rate_events (token, at) VALUES ($1, now())', [token]);
  const info = await brokerPageByToken(app, token);
  const body = await app.readJsonBody(ctx);
  const yachtSlug = str(body.yachtSlug);
  const weekStart = str(body.weekStart) ?? '';
  const clientName = str(body.clientName) ?? '';
  const queue = bool(body.queue);
  if (!yachtSlug) throw fieldErrors({ yachtSlug: 'Choose one of the listed options.' });
  const result = await placeHold(app, {
    ws: info.workspaceSlug,
    yachtSlug,
    weekStart,
    clientName,
    queue,
    placedByKind: 'broker',
    placedById: null,
    placedByName: info.broker.name,
    brokerId: info.broker.id,
  });
  const h = result.hold;
  return {
    hold: { id: h.id, yachtSlug: h.yacht_slug, weekStart: h.week_start, clientName: h.client_name, status: h.status, position: h.position, lapsesAt: h.lapses_at ? base.instToIso({ ms: h.lapses_at.getTime() }) : null },
  };
}

export async function brokerReleaseHold(app: App, ctx: Ctx, token: string, holdId: string): Promise<unknown> {
  const info = await brokerPageByToken(app, token);
  const rows = await app.pool.query<HoldRow>(holdQuery('WHERE id = $1 AND broker_id = $2'), [holdId, info.broker.id]);
  const hold = rows.rows[0];
  if (!hold) throw notFound();
  const client = await app.pool.connect();
  try {
    await client.query('BEGIN');
    const fresh = await client.query<HoldRow>(holdQuery('WHERE id = $1 FOR UPDATE'), [holdId]);
    const h = fresh.rows[0];
    if (!h) {
      await client.query('ROLLBACK');
      throw notFound();
    }
    if (h.status === 'lapsed') {
      await client.query('ROLLBACK');
      throw stateConflict('hold_lapsed', { lapsedAt: h.lapses_at ? base.instToIso({ ms: h.lapses_at.getTime() }) : null });
    }
    if (h.status === 'live') {
      if (h.lapses_at && h.lapses_at.getTime() <= Date.now()) {
        await client.query("UPDATE holds SET status = 'lapsed' WHERE id = $1", [holdId]);
        const { promoteAfter } = await import('./endpoints-holds.js');
        await promoteAfter(app, client, h.yacht_slug, h.week_start);
        await client.query('COMMIT');
        throw stateConflict('hold_lapsed', { lapsedAt: base.instToIso({ ms: h.lapses_at.getTime() }) });
      }
      await client.query("UPDATE holds SET status = 'released' WHERE id = $1", [holdId]);
      const { promoteAfter } = await import('./endpoints-holds.js');
      await promoteAfter(app, client, h.yacht_slug, h.week_start);
    } else if (h.status === 'waiting') {
      await client.query("UPDATE holds SET status = 'released', position = NULL WHERE id = $1", [holdId]);
      await client.query("UPDATE holds SET position = position - 1 WHERE yacht_slug = $1 AND week_start = $2 AND status = 'waiting' AND position > $3", [h.yacht_slug, h.week_start, h.position]);
    } else {
      await client.query('ROLLBACK');
      throw stateConflict('hold_not_live', { status: h.status });
    }
    const done = await client.query<HoldRow>(holdQuery('WHERE id = $1'), [holdId]);
    await client.query('COMMIT');
    return {
      hold: { id: done.rows[0].id, yachtSlug: done.rows[0].yacht_slug, weekStart: done.rows[0].week_start, clientName: done.rows[0].client_name, status: done.rows[0].status, position: done.rows[0].position, lapsesAt: done.rows[0].lapses_at ? base.instToIso({ ms: done.rows[0].lapses_at.getTime() }) : null },
    };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* committed */ }
    throw e;
  } finally {
    client.release();
  }
}
