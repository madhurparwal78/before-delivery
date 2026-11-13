import { randomBytes } from 'node:crypto';
import { knownIdOrNotFound } from '../db/ids';
import { config } from '../config';
import { appendLog, inHousehold, nextId, one, rows } from '../db';
import { loadHousehold, makeDeriver, householdToday, loadVersions, parentName } from '../db/repo';
import { buildYearDocument } from '../domain/documents';
import { addDays, dateYear, formatInstant, toDateString } from '../domain/time';
import { fail, failField } from '../errors';
import { ApiResponse, Ctx } from '../http/context';
import { makeCursor, readPageRequest, readYearParam, withIdempotency } from '../http/protocol';
import { Json } from '../lib/json';

function instantText(value: Date, zone: string): string {
  return formatInstant(zone, value.getTime());
}

function shareUrl(token: string): string {
  return `${config.publicUrl}/share/${token}`;
}

export async function listShareLinks(ctx: Ctx): Promise<ApiResponse> {
  const household = ctx.home;
  const page = readPageRequest(ctx, household.id);
  const zone = await ctx.zone();
  const found = await rows(
    `SELECT id::text AS id, label, token, expires_at, created_at FROM share_links
     WHERE household_id = $1 AND dead_at IS NULL AND ($2::bigint IS NULL OR id < $2)
     ORDER BY share_links.id DESC LIMIT $3`,
    [household.id, page.afterId, page.limit + 1],
  );
  const last = found[page.limit - 1];
  return {
    status: 200,
    json: {
      items: found.slice(0, page.limit).map((row) => ({
        id: row.id as string,
        label: row.label as string,
        url: shareUrl(row.token as string),
        expiresAt: instantText(row.expires_at as Date, zone),
        createdAt: instantText(row.created_at as Date, zone),
      })) as unknown as Json,
      next: found.length > page.limit && last ? makeCursor(household.id, last.id as string) : null,
    },
  };
}

export async function createShareLink(ctx: Ctx): Promise<ApiResponse> {
  const household = ctx.home;
  const label = ctx.text('label', 'Use 1 to 80 characters.', { min: 1, max: 80 });
  const expiresAt = ctx.instant('expiresAt');
  if (expiresAt <= ctx.now || expiresAt > ctx.now + 90 * 86400000) {
    failField('expiresAt', 'Choose a time in the next 90 days.');
  }
  const zone = await ctx.zone();
  return withIdempotency(ctx, async () =>
    inHousehold(household.id, async (client) => {
      const id = await nextId(client);
      const token = randomBytes(32).toString('base64url');
      const created = await client.query(
        `INSERT INTO share_links (id, household_id, label, token, expires_at)
         VALUES ($1, $2, $3, $4, to_timestamp($5 / 1000.0)) RETURNING created_at, expires_at`,
        [id, household.id, label, token, expiresAt],
      );
      const row = created.rows[0] as { created_at: Date; expires_at: Date };
      await appendLog(client, household.id, ctx.user.role, 'share_link.created', id);
      return {
        status: 201,
        json: {
          id,
          label,
          url: shareUrl(token),
          expiresAt: instantText(row.expires_at, zone),
          createdAt: instantText(row.created_at, zone),
        },
      };
    }),
  );
}

export async function regenerateShareLink(ctx: Ctx): Promise<ApiResponse> {
  const household = ctx.home;
  const id = knownIdOrNotFound(ctx.params.id);
  const zone = await ctx.zone();
  return withIdempotency(ctx, async () =>
    inHousehold(household.id, async (client) => {
      const token = randomBytes(32).toString('base64url');
      const updated = await client.query(
        `UPDATE share_links SET token = $3 WHERE household_id = $1 AND id = $2 AND dead_at IS NULL
         RETURNING label, expires_at, created_at`,
        [household.id, id, token],
      );
      const row = updated.rows[0] as { label: string; expires_at: Date; created_at: Date } | undefined;
      if (!row) fail('not_found');
      await appendLog(client, household.id, ctx.user.role, 'share_link.regenerated', id);
      return {
        status: 200,
        json: {
          id,
          label: row.label,
          url: shareUrl(token),
          expiresAt: instantText(row.expires_at, zone),
          createdAt: instantText(row.created_at, zone),
        },
      };
    }),
  );
}

export async function revokeShareLink(ctx: Ctx): Promise<ApiResponse> {
  const household = ctx.home;
  const id = knownIdOrNotFound(ctx.params.id);
  return inHousehold(household.id, async (client) => {
    const updated = await client.query(
      'UPDATE share_links SET dead_at = now() WHERE household_id = $1 AND id = $2 AND dead_at IS NULL RETURNING id',
      [household.id, id],
    );
    if (updated.rows.length === 0) fail('not_found');
    await appendLog(client, household.id, ctx.user.role, 'share_link.revoked', id);
    return { status: 204 };
  });
}

/** The public share view: handover times only, reads only, no-store. */
export async function readSharePage(ctx: Ctx): Promise<ApiResponse> {
  const token = ctx.params.token as string;
  const link = await one(
    'SELECT household_id::text AS household_id FROM share_links WHERE token = $1 AND dead_at IS NULL AND expires_at > now()',
    [token],
  );
  if (!link) fail('not_found');
  const household = await loadHousehold(link.household_id as string);
  if (!household) fail('not_found');
  const versions = await loadVersions(household.id);
  const defaultYear = dateYear(householdToday(versions, ctx.now));
  const year = readYearParam(ctx, defaultYear);
  const deriver = await makeDeriver(household.id);
  const document = buildYearDocument(household.id, year, deriver);
  const handovers: Json[] = [];
  for (let date = toDateString(year, 1, 1); dateYear(date) === year; date = addDays(date, 1)) {
    const handover = deriver.handoverOn(date);
    if (!handover) continue;
    handovers.push({
      date: handover.date,
      exchangeAt: handover.at,
      zone: handover.zone,
      from: handover.from ? parentName(household, handover.from) : null,
      to: handover.to ? parentName(household, handover.to) : null,
    });
  }
  return {
    status: 200,
    json: {
      householdName: household.name,
      year,
      yearDigest: document.digest,
      handovers,
    },
    headers: { 'Cache-Control': 'no-store' },
  };
}
