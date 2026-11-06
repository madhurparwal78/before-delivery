import { randomBytes, randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { query, queryOne, transaction } from '../db.js';
import { conflict, mailUnavailable, notFound, storageUnavailable } from '../http/errors.js';
import { readJsonBody, type Ctx, type Reply, type Router } from '../http/router.js';
import { actorInWorkspace, requireAction, type Actor } from '../auth.js';
import { formatInstant } from '../../shared/copy.js';
import { formatDate } from '../../shared/format.js';
import { Fields } from '../domain/validate.js';
import { can } from '../../shared/roles.js';
import { pageStatus, type PageRow } from '../domain/pages.js';
import { toInstantString } from '../../shared/zone.js';
import type { CharterRow } from '../domain/charters.js';
import { MailUnreachable, sendMail } from '../services/mail.js';
import { getObject, StorageUnreachable } from '../services/storage.js';
import { json } from './helpers.js';
import { charterReply } from './holds.js';

export interface GuestRow {
  readonly id: string;
  readonly charter_id: string;
  readonly full_name: string;
  readonly nationality: string | null;
  readonly date_of_birth: string | null;
  readonly passport_number: string | null;
  readonly photo_key: string | null;
  readonly photo_content_type: string | null;
  readonly seed_order: number;
}

export interface ManifestPageRow extends PageRow {
  readonly charter_id: string;
  readonly lead_guest_name: string;
  readonly lead_guest_email: string;
}

async function requireCharter(actor: Actor, charterId: string): Promise<CharterRow & { yacht_slug: string; yacht_name: string; cabins: number }> {
  const charter = await queryOne<CharterRow & { yacht_slug: string; yacht_name: string; cabins: number }>(
    `SELECT c.*, y.slug AS yacht_slug, y.name AS yacht_name, y.cabins
       FROM charters c JOIN yachts y ON y.id = c.yacht_id
      WHERE c.id = $1 AND c.workspace_id = $2`,
    [charterId, actor.workspaceId],
  );
  if (charter === null) throw notFound();
  return charter;
}

async function readCharter(ctx: Ctx): Promise<Reply> {
  const actor = await actorInWorkspace(ctx);
  const charter = await requireCharter(actor, ctx.params.charterId);
  requireAction(actor, 'charters_read');
  return charterReply(200, charter.id, charter.yacht_slug);
}

async function latestManifestPage(charterId: string): Promise<ManifestPageRow | null> {
  return queryOne<ManifestPageRow>(
    'SELECT * FROM manifest_pages WHERE charter_id = $1 ORDER BY issued_at DESC LIMIT 1',
    [charterId],
  );
}

async function closeCharter(ctx: Ctx): Promise<Reply> {
  const actor = await actorInWorkspace(ctx);
  const charter = await requireCharter(actor, ctx.params.charterId);
  requireAction(actor, 'close_charter');
  if (charter.status === 'closed') throw conflict('charter_closed');
  const erasesAt = new Date(ctx.now.getTime() + config.timers.manifestRetentionSeconds * 1000);
  await transaction(async (client) => {
    await client.query(
      `UPDATE charters SET status = 'closed', closed_at = $2, erases_at = $3 WHERE id = $1`,
      [charter.id, ctx.now, erasesAt],
    );
    await client.query(
      'UPDATE manifest_pages SET ended_at = $2 WHERE charter_id = $1 AND ended_at IS NULL',
      [charter.id, ctx.now],
    );
  });
  return charterReply(200, charter.id, charter.yacht_slug);
}

function guestForActor(actor: Actor, guest: GuestRow): Record<string, unknown> {
  if (!can(actor.role, 'passport_data')) {
    return { id: guest.id, fullName: guest.full_name };
  }
  return {
    id: guest.id,
    fullName: guest.full_name,
    nationality: guest.nationality,
    dateOfBirth: guest.date_of_birth,
    passportNumber: guest.passport_number,
    photoOnFile: guest.photo_key !== null,
  };
}

async function readManifest(ctx: Ctx): Promise<Reply> {
  const actor = await actorInWorkspace(ctx);
  const charter = await requireCharter(actor, ctx.params.charterId);
  requireAction(actor, 'manifest_read');
  const page = await latestManifestPage(charter.id);
  const status = pageStatus(page, ctx.now);
  const guests = await query<GuestRow>(
    'SELECT * FROM guests WHERE charter_id = $1 ORDER BY seed_order',
    [charter.id],
  );
  return json(200, {
    page: {
      status,
      issuedAt: page === null ? null : toInstantString(page.issued_at),
      endsAt: page === null ? null : toInstantString(page.ends_at),
      path: page !== null && can(actor.role, 'manifest_pages') ? `/m/${page.token}` : null,
    },
    guests: guests.map((guest) => guestForActor(actor, guest)),
  });
}

async function sendManifestPage(ctx: Ctx): Promise<Reply> {
  const actor = await actorInWorkspace(ctx);
  const charter = await requireCharter(actor, ctx.params.charterId);
  requireAction(actor, 'manifest_pages');
  if (charter.status === 'closed') throw conflict('charter_closed');
  const body = readJsonBody(ctx);
  const fields = new Fields();
  const leadGuestName = fields.text('leadGuestName', body.leadGuestName, 80);
  const leadGuestEmail = fields.email('leadGuestEmail', body.leadGuestEmail);
  fields.throwIfFailed();
  const token = randomBytes(24).toString('base64url');
  const endsAt = new Date(ctx.now.getTime() + config.timers.manifestPageSeconds * 1000);
  try {
    await sendMail({
      to: leadGuestEmail,
      subject: `Guest manifest for ${charter.yacht_name}, week of ${formatDate(charter.week_start)}`,
      body: [
        `Dear ${leadGuestName},`,
        '',
        `Please complete the guest manifest for ${charter.yacht_name}.`,
        `${config.appPublicUrl}/m/${token}`,
        '',
        `This link works until ${formatInstant(endsAt)}.`,
        '',
        'Tidewright',
      ].join('\n'),
    });
  } catch (error) {
    if (error instanceof MailUnreachable) throw mailUnavailable();
    throw error;
  }
  await transaction(async (client) => {
    await client.query(
      'UPDATE manifest_pages SET ended_at = $2 WHERE charter_id = $1 AND ended_at IS NULL',
      [charter.id, ctx.now],
    );
    await client.query(
      `INSERT INTO manifest_pages (id, charter_id, token, lead_guest_name, lead_guest_email, issued_at, ends_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [randomUUID(), charter.id, token, leadGuestName, leadGuestEmail, ctx.now, endsAt],
    );
  });
  return json(201, {
    page: {
      status: 'live',
      issuedAt: toInstantString(ctx.now),
      endsAt: toInstantString(endsAt),
      path: `/m/${token}`,
    },
  });
}

async function endManifestPage(ctx: Ctx): Promise<Reply> {
  const actor = await actorInWorkspace(ctx);
  const charter = await requireCharter(actor, ctx.params.charterId);
  requireAction(actor, 'manifest_pages');
  const page = await latestManifestPage(charter.id);
  if (pageStatus(page, ctx.now) !== 'live') throw conflict('page_not_live');
  const live = page as ManifestPageRow;
  await query('UPDATE manifest_pages SET ended_at = $2 WHERE id = $1', [live.id, ctx.now]);
  return json(200, {
    page: {
      status: 'ended',
      issuedAt: toInstantString(live.issued_at),
      endsAt: toInstantString(live.ends_at),
      path: `/m/${live.token}`,
    },
  });
}

async function guestPhoto(ctx: Ctx): Promise<Reply> {
  const actor = await actorInWorkspace(ctx);
  const charter = await requireCharter(actor, ctx.params.charterId);
  const guest = await queryOne<GuestRow>('SELECT * FROM guests WHERE id = $1 AND charter_id = $2', [
    ctx.params.guestId,
    charter.id,
  ]);
  if (guest === null) throw notFound();
  requireAction(actor, 'passport_data');
  if (guest.photo_key === null) throw notFound();
  try {
    const content = await getObject(guest.photo_key);
    if (content === null) throw notFound();
    return {
      status: 200,
      body: content,
      contentType: guest.photo_content_type as string,
    };
  } catch (error) {
    if (error instanceof StorageUnreachable) throw storageUnavailable();
    throw error;
  }
}

export function registerCharterRoutes(router: Router): void {
  router.add('/api/w/:ws/charters/:charterId', { GET: readCharter });
  router.add('/api/w/:ws/charters/:charterId/close', { POST: closeCharter });
  router.add('/api/w/:ws/charters/:charterId/manifest', { GET: readManifest });
  router.add('/api/w/:ws/charters/:charterId/manifest-page', { POST: sendManifestPage });
  router.add('/api/w/:ws/charters/:charterId/manifest-page/end', { POST: endManifestPage });
  router.add('/api/w/:ws/charters/:charterId/manifest/guests/:guestId/photo', { GET: guestPhoto });
}
