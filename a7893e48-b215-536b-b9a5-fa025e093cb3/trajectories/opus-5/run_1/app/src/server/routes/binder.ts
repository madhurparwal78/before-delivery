import { randomBytes, randomUUID } from 'node:crypto';
import type { Binder, BinderDocumentStatus } from '../../shared/types.js';
import { pool, query, queryOne, type Db } from '../db/pool.js';
import { buildBinder } from '../domain/binder.js';
import { siteInScope } from '../domain/records.js';
import { isDateString } from '../domain/zone.js';
import { env } from '../env.js';
import { json, noContent, type Ctx, type Reply } from '../http/context.js';
import { ApiError, validation } from '../http/errors.js';
import type { Route } from '../http/router.js';
import { buildPdf, type PdfLine } from '../services/pdf.js';
import { getObject, putObject } from '../services/storage.js';

const MAX_RANGE_DAYS = 31;

interface LinkRow {
  id: string;
  site_id: string;
  from_date: string;
  to_date: string;
  token: string;
  expires_at: Date;
  revoked: boolean;
  created_at: Date;
  generated_at: Date;
  pdf_key: string;
}

const linkNotFound = (): ApiError =>
  new ApiError(404, 'link_not_found', 'This binder link is no longer valid.');

function presentLink(row: LinkRow): Record<string, unknown> {
  return {
    id: row.id,
    site_id: row.site_id,
    from: row.from_date,
    to: row.to_date,
    url: `/binder/${row.token}`,
    expires_at: row.expires_at.toISOString(),
    revoked: row.revoked,
    created_at: row.created_at.toISOString(),
  };
}

function binderPdfKey(siteId: string, linkId: string): string {
  return `sites/${siteId}/binders/${linkId}.pdf`;
}

function statusText(status: BinderDocumentStatus): string {
  if (status.status === 'current') return `Current until ${status.expires_on ?? ''}`;
  if (status.status === 'expired') return `Expired ${status.expires_on ?? ''}`;
  return 'Missing';
}

function timeOf(stamp: string): string {
  return stamp.split(' ').slice(1).join(' ');
}

async function writeBinderPdf(db: Db, row: LinkRow): Promise<Binder> {
  const binder = await buildBinder(db, {
    siteId: row.site_id,
    from: row.from_date,
    to: row.to_date,
    generatedAt: row.generated_at,
  });
  const lines: PdfLine[] = [
    { text: 'Hearthshift compliance binder', bold: true },
    { text: binder.site_name, bold: true },
    { text: `${binder.from} to ${binder.to}` },
    { text: `Generated ${binder.generated_at}` },
    { text: '' },
    {
      text: 'Date       Renter / business                Station and time              Liability / food handler',
      bold: true,
    },
  ];
  for (const entry of binder.rows) {
    lines.push({
      text: `${entry.date} ${entry.renter_name} (${entry.business}) — ${entry.station} ${timeOf(entry.local_start)}–${timeOf(entry.local_end)} — liability: ${statusText(entry.liability)}; food handler: ${statusText(entry.food_handler)}`,
    });
  }
  if (binder.rows.length === 0) lines.push({ text: 'No bookings in this range.' });
  await putObject(binderPdfKey(row.site_id, row.id), buildPdf(lines), 'application/pdf');
  return binder;
}

async function liveLinkByToken(token: string): Promise<LinkRow> {
  const row = await queryOne<LinkRow>(pool, 'SELECT * FROM binder_links WHERE token = $1', [token]);
  if (row === null || row.revoked || row.expires_at.getTime() <= Date.now()) throw linkNotFound();
  return row;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function binderPage(binder: Binder, token: string): string {
  const rows = binder.rows
    .map(
      (entry) => `<tr>
      <td class="mono">${escapeHtml(entry.date)}</td>
      <td>${escapeHtml(entry.renter_name)}</td>
      <td>${escapeHtml(entry.business)}</td>
      <td>${escapeHtml(entry.station)} <span class="mono">${escapeHtml(timeOf(entry.local_start))}–${escapeHtml(timeOf(entry.local_end))}</span></td>
      <td>${escapeHtml(statusText(entry.liability))}</td>
      <td>${escapeHtml(statusText(entry.food_handler))}</td>
    </tr>`,
    )
    .join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Compliance binder — ${escapeHtml(binder.site_name)}</title>
<link rel="stylesheet" href="/styles.css">
</head>
<body class="binder-page">
<main class="binder">
  <h1>Compliance binder</h1>
  <p class="binder-site">${escapeHtml(binder.site_name)}</p>
  <p class="binder-range mono">${escapeHtml(binder.from)} to ${escapeHtml(binder.to)}</p>
  <p class="binder-generated">Generated <span class="mono">${escapeHtml(binder.generated_at)}</span></p>
  <p><a class="button" href="/binder/${escapeHtml(token)}/binder.pdf">Download PDF</a></p>
  <div class="table-frame">
    <table aria-label="Compliance binder">
      <thead>
        <tr><th scope="col">Date</th><th scope="col">Renter</th><th scope="col">Business</th><th scope="col">Station and time</th><th scope="col">Liability certificate</th><th scope="col">Food handler card</th></tr>
      </thead>
      <tbody>
${rows}
      </tbody>
    </table>
  </div>
</main>
</body>
</html>`;
}

export function deadBinderPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Binder link</title>
<link rel="stylesheet" href="/styles.css">
</head>
<body class="binder-page">
<main class="binder">
  <h1>This binder link is no longer valid</h1>
</main>
</body>
</html>`;
}

function validateRange(body: Record<string, unknown>): { from: string; to: string } {
  const fields: Record<string, string> = {};
  if (!isDateString(body.from)) fields.from = 'Give a date as YYYY-MM-DD.';
  if (!isDateString(body.to)) fields.to = 'Give a date as YYYY-MM-DD.';
  if (Object.keys(fields).length > 0) throw validation(fields);
  const from = body.from as string;
  const to = body.to as string;
  if (to < from) {
    throw validation({ to: 'The end date cannot be before the start date.' });
  }
  const span =
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  if (span > MAX_RANGE_DAYS) throw validation({ to: 'Cover at most 31 days.' });
  return { from, to };
}

async function createLink(ctx: Ctx): Promise<Reply> {
  const actor = ctx.requireActor();
  const site = await siteInScope(actor, ctx.params.id as string);
  ctx.requireRole('manager');
  const range = validateRange(ctx.body());
  const id = `bl-${randomUUID()}`;
  const inserted = await pool.query<LinkRow>(
    `INSERT INTO binder_links (id, site_id, from_date, to_date, token, expires_at, generated_at, pdf_key)
     VALUES ($1, $2, $3, $4, $5, now() + ($6 || ' seconds')::interval, now(), $7)
     RETURNING *`,
    [
      id,
      site.id,
      range.from,
      range.to,
      randomBytes(24).toString('base64url'),
      String(env.binderLinkTtlSeconds),
      binderPdfKey(site.id, id),
    ],
  );
  const row = inserted.rows[0];
  if (row === undefined) throw new Error('binder link insert returned nothing');
  await writeBinderPdf(pool, row);
  return json(201, { link: presentLink(row) });
}

async function regenerateLink(ctx: Ctx): Promise<Reply> {
  const actor = ctx.requireActor();
  const existing = await queryOne<LinkRow>(pool, 'SELECT * FROM binder_links WHERE id = $1', [
    ctx.params.id as string,
  ]);
  if (existing === null) throw linkNotFound();
  await siteInScope(actor, existing.site_id);
  ctx.requireRole('manager');
  if (existing.revoked) {
    throw new ApiError(409, 'invalid_transition', 'That binder link was revoked.', {
      from: 'revoked',
      action: 'regenerate',
    });
  }
  const updated = await pool.query<LinkRow>(
    `UPDATE binder_links
        SET token = $2, expires_at = now() + ($3 || ' seconds')::interval, generated_at = now()
      WHERE id = $1 RETURNING *`,
    [existing.id, randomBytes(24).toString('base64url'), String(env.binderLinkTtlSeconds)],
  );
  const row = updated.rows[0];
  if (row === undefined) throw new Error('binder link update returned nothing');
  await writeBinderPdf(pool, row);
  return json(200, { link: presentLink(row) });
}

export const binderRoutes: Route[] = [
  {
    method: 'GET',
    pattern: '/api/sites/:id/binder-links',
    handle: async (ctx): Promise<Reply> => {
      const actor = ctx.requireActor();
      const site = await siteInScope(actor, ctx.params.id as string);
      ctx.requireRole('manager');
      const rows = await query<LinkRow>(
        pool,
        'SELECT * FROM binder_links WHERE site_id = $1 ORDER BY created_at DESC',
        [site.id],
      );
      return json(200, { links: rows.map(presentLink) });
    },
  },
  { method: 'POST', pattern: '/api/sites/:id/binder-links', handle: createLink },
  { method: 'POST', pattern: '/api/binder-links/:id/regenerate', handle: regenerateLink },
  {
    method: 'DELETE',
    pattern: '/api/binder-links/:id',
    handle: async (ctx): Promise<Reply> => {
      const actor = ctx.requireActor();
      const existing = await queryOne<LinkRow>(pool, 'SELECT * FROM binder_links WHERE id = $1', [
        ctx.params.id as string,
      ]);
      if (existing === null) throw linkNotFound();
      await siteInScope(actor, existing.site_id);
      ctx.requireRole('manager');
      await pool.query('UPDATE binder_links SET revoked = true WHERE id = $1', [existing.id]);
      return noContent();
    },
  },
  {
    method: 'GET',
    pattern: '/api/binder/:token',
    handle: async (ctx): Promise<Reply> => {
      const link = await liveLinkByToken(ctx.params.token as string);
      return json(
        200,
        await buildBinder(pool, {
          siteId: link.site_id,
          from: link.from_date,
          to: link.to_date,
          generatedAt: link.generated_at,
        }),
      );
    },
  },
  {
    method: 'GET',
    pattern: '/binder/:token',
    handle: async (ctx): Promise<Reply> => {
      const token = ctx.params.token as string;
      const row = await queryOne<LinkRow>(pool, 'SELECT * FROM binder_links WHERE token = $1', [
        token,
      ]);
      if (row === null || row.revoked || row.expires_at.getTime() <= Date.now()) {
        return {
          status: 404,
          bytes: Buffer.from(deadBinderPage(), 'utf8'),
          contentType: 'text/html; charset=utf-8',
        };
      }
      const binder = await buildBinder(pool, {
        siteId: row.site_id,
        from: row.from_date,
        to: row.to_date,
        generatedAt: row.generated_at,
      });
      return {
        status: 200,
        bytes: Buffer.from(binderPage(binder, token), 'utf8'),
        contentType: 'text/html; charset=utf-8',
      };
    },
  },
  {
    method: 'GET',
    pattern: '/binder/:token/binder.pdf',
    handle: async (ctx): Promise<Reply> => {
      const link = await liveLinkByToken(ctx.params.token as string);
      const stored = await getObject(link.pdf_key);
      const bytes = stored?.body ?? (await regeneratePdfBytes(link));
      return {
        status: 200,
        bytes,
        contentType: 'application/pdf',
        headers: { 'content-disposition': `inline; filename="binder-${link.id}.pdf"` },
      };
    },
  },
];

async function regeneratePdfBytes(link: LinkRow): Promise<Buffer> {
  await writeBinderPdf(pool, link);
  const stored = await getObject(link.pdf_key);
  if (stored === null) throw new Error('binder pdf missing after write');
  return stored.body;
}
