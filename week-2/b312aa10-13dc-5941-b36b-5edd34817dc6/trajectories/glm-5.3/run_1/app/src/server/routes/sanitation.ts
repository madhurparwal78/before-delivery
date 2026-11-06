import { callerOf, forbidden } from '../api-core.js';
import { ApiError, monthName } from '../errors.js';
import { withContentionRetry } from '../db.js';
import { parseJsonBody, type Handler, type RouteContext } from '../pipeline.js';
import { currentMonthInZone, formatInstant, localDateInZone, localTimeInZone } from '../time.js';
import { codePoints, isValidEmail, newId, normaliseText, randomToken } from '../util.js';
import type { PoolClient } from 'pg';

const nowDate = (): Date => new Date();

const AREAS = ['Prep stations', 'Ovens and ranges', 'Walk-in cooler', 'Dish area', 'Floors and drains'];

// ---------------------------------------------------------------------------
// POST /api/sanitation-entries
// ---------------------------------------------------------------------------
export const createSanitationEntry: Handler = async (req, res) => {
  const caller = callerOf(req);
  if (caller.person.role === 'member') throw forbidden();
  const body = parseJsonBody(req.rawBody) as Record<string, unknown>;
  const errors: Record<string, string> = {};
  for (const key of Object.keys(body)) {
    if (!['area', 'task', 'sanitizerPpm', 'initials', 'notes'].includes(key)) errors[key] = 'This field cannot be set.';
  }
  const area = typeof body.area === 'string' ? body.area : '';
  const task = typeof body.task === 'string' ? body.task : '';
  const initials = typeof body.initials === 'string' ? body.initials : '';
  const notes = body.notes === undefined ? '' : String(body.notes);
  const ppm = body.sanitizerPpm === undefined || body.sanitizerPpm === null ? null : Number(body.sanitizerPpm);
  if (!AREAS.includes(area)) errors.area = 'Choose an area.';
  if (codePoints(normaliseText(task)) < 1 || codePoints(normaliseText(task)) > 120) errors.task = 'Describe the task in 1 to 120 characters.';
  if (ppm !== null && (!Number.isInteger(ppm) || ppm < 0 || ppm > 400)) errors.sanitizerPpm = 'Sanitizer strength is 0 to 400 ppm.';
  if (!/^[A-Za-z]{1,4}$/.test(initials)) errors.initials = 'Initials are 1 to 4 letters.';
  if (codePoints(normaliseText(notes)) > 500) errors.notes = 'Notes can be at most 500 characters.';
  if (Object.keys(errors).length > 0) throw new ApiError('validation_failed', { errors });
  await withContentionRetry(async (client) => {
    const instant = nowDate();
    const id = newId('san');
    await client.query(
      `INSERT INTO sanitation_entries (id, kitchen_id, area, task, sanitizer_ppm, initials, notes, logged_at, logged_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, caller.kitchen.id, area, normaliseText(task), ppm, initials, normaliseText(notes), instant, caller.person.name],
    );
    const row = (await client.query<{ id: string; area: string; task: string; sanitizer_ppm: number | null; initials: string; notes: string; logged_at: Date; logged_by: string }>(
      `SELECT * FROM sanitation_entries WHERE id=$1`,
      [id],
    )).rows[0];
    res.status(201).json({ entry: entryObject(row, caller.kitchen.time_zone) });
  });
};

function entryObject(row: { id: string; area: string; task: string; sanitizer_ppm: number | null; initials: string; notes: string; logged_at: Date; logged_by: string }, tz: string): Record<string, unknown> {
  return {
    id: row.id,
    area: row.area,
    task: row.task,
    sanitizerPpm: row.sanitizer_ppm,
    initials: row.initials,
    notes: row.notes,
    loggedAt: formatInstant(row.logged_at, tz),
    localDate: localDateInZone(row.logged_at, tz),
    localTime: localTimeInZone(row.logged_at, tz),
    loggedBy: row.logged_by,
  };
}

// ---------------------------------------------------------------------------
// GET /api/sanitation-entries?month=
// ---------------------------------------------------------------------------
export const listSanitationEntries: Handler = async (req, res) => {
  const caller = callerOf(req);
  if (caller.person.role === 'member') throw forbidden();
  let month = currentMonthInZone(nowDate(), caller.kitchen.time_zone);
  if (typeof req.query.month === 'string') {
    if (!/^\d{4}-\d{2}$/.test(req.query.month)) {
      throw new ApiError('validation_failed', { errors: { month: 'Use a month in the form YYYY-MM.' } });
    }
    month = req.query.month;
  }
  await withContentionRetry(async (client) => {
    const rows = (await client.query<{ id: string; area: string; task: string; sanitizer_ppm: number | null; initials: string; notes: string; logged_at: Date; logged_by: string }>(
      `SELECT * FROM sanitation_entries WHERE kitchen_id=$1 AND to_char(logged_at AT TIME ZONE $2, 'YYYY-MM')=$3 ORDER BY logged_at DESC`,
      [caller.kitchen.id, caller.kitchen.time_zone, month],
    )).rows;
    res.status(200).json({ entries: rows.map((row) => entryObject(row, caller.kitchen.time_zone)) });
  });
};

// ---------------------------------------------------------------------------
// POST /api/sanitation-reports — the monthly PDF
// ---------------------------------------------------------------------------
export const createSanitationReport: Handler = async (req, res, ctx) => {
  const caller = callerOf(req);
  if (caller.person.role !== 'operator') throw forbidden();
  const body = parseJsonBody(req.rawBody) as Record<string, unknown>;
  const errors: Record<string, string> = {};
  for (const key of Object.keys(body)) {
    if (key !== 'month') errors[key] = 'This field cannot be set.';
  }
  const month = typeof body.month === 'string' ? body.month : '';
  if (!/^\d{4}-\d{2}$/.test(month)) errors.month = 'Use a month in the form YYYY-MM.';
  if (Object.keys(errors).length > 0) throw new ApiError('validation_failed', { errors });
  await withContentionRetry(async (client) => {
    const instant = nowDate();
    const existing = await client.query<{ status: string }>(
      `SELECT status FROM sanitation_reports WHERE kitchen_id=$1 AND month=$2`,
      [caller.kitchen.id, month],
    );
    if (existing.rows[0]?.status === 'queued') {
      // Requesting a month that is already queued does not add another.
      res.status(202).json({ report: { month, status: 'queued', storedAt: null } });
      return;
    }
    const entries = (await client.query<{ area: string; task: string; sanitizer_ppm: number | null; initials: string; notes: string; logged_at: Date; logged_by: string; id: string }>(
      `SELECT * FROM sanitation_entries WHERE kitchen_id=$1 AND to_char(logged_at AT TIME ZONE $2, 'YYYY-MM')=$3 ORDER BY logged_at`,
      [caller.kitchen.id, caller.kitchen.time_zone, month],
    )).rows;
    const pdf = renderSanitationPdf(month, entries.map((e) => entryObject(e, caller.kitchen.time_zone)));
    try {
      await ctx.storage.put(`kitchens/${caller.kitchen.id}/sanitation/${month}.pdf`, pdf, 'application/pdf');
      await client.query(
        `INSERT INTO sanitation_reports (kitchen_id, month, status, stored_at, requested_at) VALUES ($1,$2,'stored',$3,now())
         ON CONFLICT (kitchen_id, month) DO UPDATE SET status='stored', stored_at=$3`,
        [caller.kitchen.id, month, instant],
      );
      res.status(201).json({ report: { month, status: 'stored', storedAt: formatInstant(instant, caller.kitchen.time_zone) } });
    } catch {
      await client.query(
        `INSERT INTO sanitation_reports (kitchen_id, month, status, requested_at) VALUES ($1,$2,'queued',now())
         ON CONFLICT (kitchen_id, month) DO UPDATE SET status='queued'`,
        [caller.kitchen.id, month],
      );
      await client.query(`INSERT INTO outbox (id, kind, payload) VALUES ($1,'sanitation_pdf',$2::jsonb)`, [
        newId('out'),
        JSON.stringify({ kitchenId: caller.kitchen.id, month, timeZone: caller.kitchen.time_zone }),
      ]);
      res.status(202).json({ report: { month, status: 'queued', storedAt: null } });
    }
  });
};

/** A monthly PDF listing every entry of its month, as selectable text. */
export function renderSanitationPdf(month: string, entries: Record<string, unknown>[]): Buffer {
  const lines = [`Sanitation log ${monthName(month)}`, ''];
  for (const entry of entries) {
    lines.push(
      `${entry.localDate} ${entry.localTime} | ${entry.area} | ${entry.task} | ${entry.sanitizerPpm ?? '-'} ppm | ${entry.initials} | ${entry.loggedBy}` +
        (entry.notes ? ` | ${entry.notes}` : ''),
    );
  }
  const fontSize = 10;
  const lineHeight = 14;
  let content = 'BT ';
  let y = 760;
  for (const line of lines) {
    const escaped = String(line).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    content += `/F1 ${fontSize} Tf 1 0 0 1 40 ${y} Tm (${escaped}) Tj\n`;
    y -= lineHeight;
    if (y < 40) break;
  }
  content += 'ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefPos = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

// ---------------------------------------------------------------------------
// GET /api/sanitation-reports
// ---------------------------------------------------------------------------
export const listSanitationReports: Handler = async (req, res) => {
  const caller = callerOf(req);
  if (caller.person.role === 'member') throw forbidden();
  await withContentionRetry(async (client) => {
    const rows = (await client.query<{ month: string; status: string; stored_at: Date | null }>(
      `SELECT month, status, stored_at FROM sanitation_reports WHERE kitchen_id=$1 ORDER BY month DESC`,
      [caller.kitchen.id],
    )).rows;
    res.status(200).json({
      reports: rows.map((row) => ({ month: row.month, status: row.status, storedAt: row.stored_at ? formatInstant(row.stored_at, caller.kitchen.time_zone) : null })),
    });
  });
};

// ---------------------------------------------------------------------------
// GET /api/sanitation-reports/{month}/file
// ---------------------------------------------------------------------------
export const downloadSanitationReport: Handler = async (req, res, ctx) => {
  const caller = callerOf(req);
  if (caller.person.role === 'member') throw forbidden();
  const month = String(req.params.month);
  const status = (await withContentionRetry(async (client) => {
    const row = (await client.query<{ status: string }>(`SELECT status FROM sanitation_reports WHERE kitchen_id=$1 AND month=$2`, [caller.kitchen.id, month])).rows[0];
    return row?.status;
  }))!;
  if (status !== 'stored') throw new ApiError('not_found');
  let bytes: Buffer;
  try {
    bytes = (await ctx.storage.get(`kitchens/${caller.kitchen.id}/sanitation/${month}.pdf`))!;
  } catch {
    throw new ApiError('storage_unavailable', {}, (n) => (n === 'storageKind' ? 'download' : ''));
  }
  if (!bytes) throw new ApiError('not_found');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="sanitation-${caller.kitchen.slug}-${month}.pdf"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).end(bytes);
};

// ---------------------------------------------------------------------------
// Inspector links
// ---------------------------------------------------------------------------
export const createInspectorLink: Handler = async (req, res, ctx) => {
  const caller = callerOf(req);
  if (caller.person.role !== 'operator') throw forbidden();
  const body = parseJsonBody(req.rawBody) as Record<string, unknown>;
  const errors: Record<string, string> = {};
  for (const key of Object.keys(body)) {
    if (!['email', 'expiresAt'].includes(key)) errors[key] = 'This field cannot be set.';
  }
  const email = typeof body.email === 'string' ? body.email : '';
  const expiresAtRaw = typeof body.expiresAt === 'string' ? body.expiresAt : '';
  if (!isValidEmail(email)) errors.email = 'Enter a valid email address.';
  let expiresAt: Date | null = null;
  if (expiresAtRaw) {
    expiresAt = new Date(expiresAtRaw);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= nowDate().getTime() || expiresAt.getTime() > nowDate().getTime() + 30 * 86400000) {
      errors.expiresAt = 'Choose an expiry in the future, at most 30 days away.';
    }
  } else {
    errors.expiresAt = 'Choose an expiry in the future, at most 30 days away.';
  }
  if (Object.keys(errors).length > 0) throw new ApiError('validation_failed', { errors });
  await withContentionRetry(async (client) => {
    const id = newId('lnk');
    const token = randomToken(43);
    await client.query(
      `INSERT INTO inspector_links (id, kitchen_id, email, expires_at, active_token) VALUES ($1,$2,$3,$4,$5)`,
      [id, caller.kitchen.id, email, expiresAt, token],
    );
    await client.query(`INSERT INTO inspector_tokens (token, link_id) VALUES ($1,$2)`, [token, id]);
    await queueInspectorMail(client, originOf(req), caller.kitchen.time_zone, caller.kitchen.name, email, token, expiresAt!);
    const link = await loadLink(client, id, caller.kitchen.time_zone);
    res.status(201).json({ link: { ...link, url: `${originOf(req)}/inspect/${token}` } });
  });
};

function originOf(req: { headers: Record<string, string | string[] | undefined> }): string {
  const host = (req.headers.host as string) ?? 'localhost:4173';
  return `http://${host}`;
}

async function queueInspectorMail(client: PoolClient, origin: string, tz: string, kitchenName: string, email: string, token: string, expiresAt: Date): Promise<void> {
  await client.query(`INSERT INTO outbox (id, kind, payload) VALUES ($1,'mail',$2::jsonb)`, [
    newId('out'),
    JSON.stringify({
      kind: 'mail',
      to: email,
      subject: `Read-only kitchen records: ${kitchenName}`,
      body: `${kitchenName}\r\n${origin}/inspect/${token}\r\nAvailable until ${formatInstant(expiresAt, tz)}`,
    }),
  ]);
}

async function loadLink(client: PoolClient, id: string, tz: string): Promise<Record<string, unknown>> {
  const link = (await client.query<{ id: string; email: string; expires_at: Date; revoked_at: Date | null }>(
    `SELECT * FROM inspector_links WHERE id=$1`,
    [id],
  )).rows[0];
  const access = (await client.query<{ at: Date; action: string; target: string | null; seq: string }>(
    `SELECT at, action, target, seq::text AS seq FROM inspector_access WHERE link_id=$1 ORDER BY seq DESC LIMIT 50`,
    [id],
  )).rows;
  const counts = (await client.query<{ views: string; downloads: string; last: Date | null }>(
    `SELECT count(*) FILTER (WHERE action='view')::text AS views,
            count(*) FILTER (WHERE action IN ('document','report'))::text AS downloads,
            max(at) AS last
       FROM inspector_access WHERE link_id=$1`,
    [id],
  )).rows[0];
  const now = nowDate();
  const status = link.revoked_at ? 'revoked' : link.expires_at.getTime() <= now.getTime() ? 'expired' : 'active';
  return {
    id: link.id,
    email: link.email,
    expiresAt: formatInstant(link.expires_at, tz),
    status,
    lastAccessAt: counts.last ? formatInstant(counts.last, tz) : null,
    views: Number(counts.views),
    downloads: Number(counts.downloads),
    access: access.map((row) => ({ at: formatInstant(row.at, tz), action: row.action, target: row.target })),
  };
}

export const listInspectorLinks: Handler = async (req, res) => {
  const caller = callerOf(req);
  if (caller.person.role !== 'operator') throw forbidden();
  await withContentionRetry(async (client) => {
    const rows = (await client.query<{ id: string }>(
      `SELECT id FROM inspector_links WHERE kitchen_id=$1 ORDER BY created_at DESC`,
      [caller.kitchen.id],
    )).rows;
    const links = [];
    for (const row of rows) links.push(await loadLink(client, row.id, caller.kitchen.time_zone));
    res.status(200).json({ links });
  });
};

export const regenerateInspectorLink: Handler = async (req, res, ctx) => {
  const caller = callerOf(req);
  if (caller.person.role !== 'operator') throw forbidden();
  const id = String(req.params.id);
  await withContentionRetry(async (client) => {
    const link = (await client.query<{ id: string; email: string; expires_at: Date }>(`SELECT * FROM inspector_links WHERE id=$1`, [id])).rows[0];
    if (!link || (await kitchenOfLink(client, id)) !== caller.kitchen.id) throw new ApiError('not_found');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`link:${id}`]);
    const token = randomToken(43);
    await client.query(`UPDATE inspector_links SET active_token=$2 WHERE id=$1`, [id, token]);
    await client.query(`UPDATE inspector_tokens SET active=false WHERE link_id=$1`, [id]);
    await client.query(`INSERT INTO inspector_tokens (token, link_id) VALUES ($1,$2)`, [token, id]);
    await queueInspectorMail(client, originOf(req), caller.kitchen.time_zone, caller.kitchen.name, link.email, token, link.expires_at);
    const out = await loadLink(client, id, caller.kitchen.time_zone);
    res.status(200).json({ link: { ...out, url: `${originOf(req)}/inspect/${token}` } });
  });
};

async function kitchenOfLink(client: PoolClient, id: string): Promise<string> {
  const row = (await client.query<{ kitchen_id: string }>(`SELECT kitchen_id FROM inspector_links WHERE id=$1`, [id])).rows[0];
  return row?.kitchen_id ?? '';
}

export const revokeInspectorLink: Handler = async (req, res) => {
  const caller = callerOf(req);
  if (caller.person.role !== 'operator') throw forbidden();
  const id = String(req.params.id);
  await withContentionRetry(async (client) => {
    const link = (await client.query<{ id: string }>(`SELECT id FROM inspector_links WHERE id=$1`, [id])).rows[0];
    if (!link || (await kitchenOfLink(client, id)) !== caller.kitchen.id) throw new ApiError('not_found');
    await client.query(`UPDATE inspector_links SET revoked_at=now() WHERE id=$1`, [id]);
    await client.query(`UPDATE inspector_tokens SET active=false WHERE link_id=$1`, [id]);
    const out = await loadLink(client, id, caller.kitchen.time_zone);
    res.status(200).json({ link: out });
  });
};

export { loadLink, entryObject };
