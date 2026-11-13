// Share links: create, list, invite by email, revoke, and the public link lookup.
import { randomBytes, randomUUID } from 'node:crypto';
import { COPY } from '../shared/copy.ts';
import type { LinkInfo, ShareAccess, ShareView } from '../shared/types.ts';
import { assertLinkActive, assertMay, authorizeDrawing, linkStatus, requireCaller, type ShareRow } from './access.ts';
import { isEmail } from './accounts.ts';
import { dateLabel, studioDate, workspaceNow, zoneEndOfDay } from './clock.ts';
import { config } from './config.ts';
import { isUuid, query, transaction } from './db.ts';
import { publishDrawing } from './events.ts';
import { HttpError, registerRoute, validation } from './http.ts';
import { sendMail } from './smtp.ts';

const ACCESS_LABEL: Record<ShareAccess, string> = { view: 'Can view', markup: 'Can mark up', edit: 'Can edit' };
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

const isShareAccess = (value: unknown): value is ShareAccess => typeof value === 'string' && value in ACCESS_LABEL;

function isCalendarDate(text: string): boolean {
  const found = YMD.exec(text);
  if (!found) return false;
  const [year, month, day] = found.slice(1).map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  return date.getUTCFullYear() === year && date.getUTCMonth() === (month ?? 1) - 1 && date.getUTCDate() === day;
}

/** The `status "Link"` copy. */
function expiryLabel(share: Pick<ShareRow, 'expiry_date' | 'time_zone'>): string {
  return share.expiry_date ? `Expires ${dateLabel(share.expiry_date)}, 11:59 PM (${share.time_zone})` : 'Does not expire';
}

function shareView(share: ShareRow, now: Date): ShareView {
  return {
    id: share.id,
    token: share.token,
    url: `${config.publicUrl}/s/${share.token}`,
    access: share.access,
    recipient_email: share.recipient_email,
    recipient_name: share.recipient_name,
    expires_at: share.expires_at ? share.expires_at.toISOString() : null,
    time_zone: share.time_zone,
    status: linkStatus(share, now),
  };
}

async function findShare(id: string): Promise<ShareRow> {
  const share = isUuid(id) ? (await query<ShareRow>('SELECT * FROM shares WHERE id = $1', [id]))[0] : undefined;
  if (!share) throw new HttpError(404, { error: 'not_found' });
  return share;
}

export function registerShareRoutes(): void {
  registerRoute('POST', '/api/drawings/:id/shares', async (ctx) => {
    const da = await authorizeDrawing(ctx, ctx.params.id ?? '');
    assertMay(da.access, 'owner', da);
    const body = await ctx.json();
    const errors: Record<string, string> = {};
    if (!isShareAccess(body.access)) errors.access = 'Choose Can view, Can mark up or Can edit.';
    const email = typeof body.recipient_email === 'string' ? body.recipient_email.trim() : '';
    if (!isEmail(email)) errors.recipient_email = COPY.emailInvalid;
    const expiry = body.expiry_date ?? null;
    if (expiry !== null && (typeof expiry !== 'string' || !isCalendarDate(expiry))) errors.expiry_date = COPY.expiryFormat;
    else if (typeof expiry === 'string' && expiry < studioDate(da.now, da.zone)) errors.expiry_date = COPY.expiryPast;
    if (Object.keys(errors).length > 0 || !isShareAccess(body.access)) throw validation(errors);
    const name = typeof body.recipient_name === 'string' ? body.recipient_name.trim() : '';
    const share: ShareRow = {
      id: randomUUID(),
      drawing_id: da.drawing.id,
      token: randomBytes(32).toString('base64url'),
      access: body.access,
      recipient_email: email,
      recipient_name: name || email.split('@')[0] || email,
      expiry_date: typeof expiry === 'string' ? expiry : null,
      expires_at: typeof expiry === 'string' ? zoneEndOfDay(expiry, da.zone) : null,
      time_zone: da.zone,
      revoked_at: null,
      last_invite_at: null,
      created_at: da.now,
    };
    await query(
      `INSERT INTO shares (id, drawing_id, token, access, recipient_email, recipient_name, expiry_date, expires_at, time_zone, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [share.id, share.drawing_id, share.token, share.access, share.recipient_email, share.recipient_name,
        share.expiry_date, share.expires_at, share.time_zone, share.created_at],
    );
    return { status: 201, body: { share: shareView(share, da.now) } };
  });

  registerRoute('GET', '/api/drawings/:id/shares', async (ctx) => {
    const da = await authorizeDrawing(ctx, ctx.params.id ?? '');
    assertMay(da.access, 'owner', da);
    const shares = await query<ShareRow>('SELECT * FROM shares WHERE drawing_id = $1 ORDER BY created_at, id', [da.drawing.id]);
    return { status: 200, body: { shares: shares.map((share) => shareView(share, da.now)) } };
  });

  registerRoute('POST', '/api/shares/:id/invite', async (ctx) => {
    requireCaller(ctx);
    const found = await findShare(ctx.params.id ?? '');
    const da = await authorizeDrawing(ctx, found.drawing_id);
    assertMay(da.access, 'owner', da);
    const sentTo = await transaction(async (client) => {
      const { rows } = await client.query<ShareRow>('SELECT * FROM shares WHERE id = $1 FOR UPDATE', [found.id]);
      const share = rows[0];
      if (!share) throw new HttpError(404, { error: 'not_found' });
      assertLinkActive(share, da.now);
      const siblings = await client.query<{ last_invite_at: Date | null }>(
        'SELECT last_invite_at FROM shares WHERE drawing_id = $1 AND lower(recipient_email) = lower($2) FOR UPDATE',
        [share.drawing_id, share.recipient_email],
      );
      const last = Math.max(0, ...siblings.rows.map((row) => row.last_invite_at?.getTime() ?? 0));
      const waited = da.now.getTime() - last;
      if (last > 0 && waited < config.inviteCooldownSeconds * 1000) {
        const remaining = Math.ceil((config.inviteCooldownSeconds * 1000 - waited) / 1000);
        throw new HttpError(429, { error: 'invite_cooldown', retry_after_seconds: Math.min(config.inviteCooldownSeconds, Math.max(1, remaining)) });
      }
      const accepted = await sendMail({
        to: share.recipient_email,
        subject: `${da.ownerName} shared "${da.drawing.name}" with you`,
        text: `${da.ownerName} shared "${da.drawing.name}" with you.\n\n${config.publicUrl}/s/${share.token}\n${ACCESS_LABEL[share.access]}\n${expiryLabel(share)}\n`,
      });
      if (!accepted) throw new HttpError(503, { error: 'mail_unavailable' });
      await client.query('UPDATE shares SET last_invite_at = $2 WHERE id = $1', [share.id, da.now]);
      return share.recipient_email;
    });
    return { status: 200, body: { invite: 'sent', sent_to: sentTo } };
  });

  registerRoute('POST', '/api/shares/:id/revoke', async (ctx) => {
    requireCaller(ctx);
    const found = await findShare(ctx.params.id ?? '');
    const da = await authorizeDrawing(ctx, found.drawing_id);
    assertMay(da.access, 'owner', da);
    const [share] = await query<ShareRow>('UPDATE shares SET revoked_at = coalesce(revoked_at, $2) WHERE id = $1 RETURNING *', [found.id, da.now]);
    if (!share) throw new HttpError(404, { error: 'not_found' });
    await publishDrawing(share.drawing_id, { type: 'link', status: 'revoked', share_id: share.id });
    return { status: 200, body: { share: shareView(share, da.now) } };
  });

  registerRoute('GET', '/api/links/:token', async (ctx) => {
    const [row] = await query<ShareRow & { workspace_id: string; drawing_name: string }>(
      `SELECT s.*, d.workspace_id, d.name AS drawing_name FROM shares s JOIN drawings d ON d.id = s.drawing_id
        WHERE s.token = $1 AND d.deleted_at IS NULL`,
      [ctx.params.token ?? ''],
    );
    if (!row) throw new HttpError(404, { error: 'not_found' });
    assertLinkActive(row, await workspaceNow(row.workspace_id));
    const info: LinkInfo = {
      drawing: { id: row.drawing_id, name: row.drawing_name },
      access: row.access,
      status: 'active',
      expires_at: row.expires_at ? row.expires_at.toISOString() : null,
      time_zone: row.time_zone,
      expiry_label: expiryLabel(row),
    };
    return { status: 200, body: info };
  }, { anonymous: true });
}
