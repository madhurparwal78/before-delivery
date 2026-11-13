import { copy } from '../../shared/copy';
import { ApiError, fail, ValidationError } from '../errors';
import { linkExpiryInstant, parseIsoDate, studioToday, workspaceNow } from '../clock';
import { assertOwner, resolveDrawingCaller } from '../access';
import { findWorkspace } from '../accounts';
import { findDrawingRecord } from '../drawings';
import { sendInviteEmail } from '../emails';
import { MailUnavailable } from '../mail';
import { publishDrawing } from '../live';
import {
  accessLabel,
  assertLinkUsable,
  createShare,
  expiryLabel,
  findShareById,
  findShareByToken,
  inviteCooldownRemaining,
  listShares,
  recordInvite,
  revokeShare,
  serializeShare,
  shareStatus,
  shareUrl,
} from '../shares';
import { json, type Router } from '../http';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

export function registerShareRoutes(router: Router): void {
  router.add('POST', '/api/drawings/:id/shares', async (context) => {
    const caller = await resolveDrawingCaller(context, context.params.id!);
    const body = await context.json();
    assertOwner(caller);
    const errors: Record<string, string> = {};
    const access = body.access;
    if (access !== 'view' && access !== 'markup' && access !== 'edit') {
      errors.access = 'Choose an access level.';
    }
    const email = typeof body.recipient_email === 'string' ? body.recipient_email.trim() : '';
    if (!EMAIL_PATTERN.test(email)) errors.recipient_email = copy.account.emailError;
    let expiryDate: string | null = null;
    if (typeof body.expiry_date === 'string' && body.expiry_date !== '') {
      if (parseIsoDate(body.expiry_date) === null) errors.expiry_date = copy.access.expiryFormatError;
      else if (body.expiry_date < studioToday(caller.workspace)) {
        errors.expiry_date = copy.access.expiryPastError;
      } else expiryDate = body.expiry_date;
    }
    if (Object.keys(errors).length > 0) throw new ValidationError(errors);
    const share = await createShare({
      drawingId: caller.drawing.id,
      access: access as 'view' | 'markup' | 'edit',
      recipientEmail: email,
      recipientName: typeof body.recipient_name === 'string' && body.recipient_name.trim() !== ''
        ? body.recipient_name.trim()
        : email,
      expiryDate,
      now: caller.now,
    });
    return json(201, { share: serializeShare(share, caller.workspace, caller.now) });
  });

  router.add('GET', '/api/drawings/:id/shares', async (context) => {
    const caller = await resolveDrawingCaller(context, context.params.id!);
    assertOwner(caller);
    const shares = await listShares(caller.drawing.id);
    return json(200, { shares: shares.map((share) => serializeShare(share, caller.workspace, caller.now)) });
  });

  router.add('POST', '/api/shares/:id/invite', async (context) => {
    const share = await findShareById(context.params.id!);
    if (share === null) fail('not_found');
    const caller = await resolveDrawingCaller(context, share.drawing_id);
    assertOwner(caller);
    const remaining = await inviteCooldownRemaining(share.drawing_id, share.recipient_email, caller.now);
    if (remaining > 0) throw new ApiError('invite_cooldown', { retry_after_seconds: remaining });
    try {
      await sendInviteEmail({
        to: share.recipient_email,
        drafterName: caller.ownerName,
        drawingName: caller.drawing.name,
        url: shareUrl(share.token),
        accessLabel: accessLabel(share.access),
        expiryLine: expiryLabel(share, caller.workspace),
      });
    } catch (error) {
      if (!(error instanceof MailUnavailable)) throw error;
      fail('mail_unavailable');
    }
    await recordInvite(share.drawing_id, share.recipient_email, caller.now);
    return json(200, { invite: 'sent', sent_to: share.recipient_email });
  });

  router.add('POST', '/api/shares/:id/revoke', async (context) => {
    const share = await findShareById(context.params.id!);
    if (share === null) fail('not_found');
    const caller = await resolveDrawingCaller(context, share.drawing_id);
    assertOwner(caller);
    const revoked = await revokeShare(share, caller.now);
    await publishDrawing(share.drawing_id, { type: 'link', status: 'revoked', share_id: share.id });
    return json(200, { share: serializeShare(revoked, caller.workspace, caller.now) });
  });

  router.add('GET', '/api/links/:token', async (context) => {
    const share = await findShareByToken(context.params.token!);
    if (share === null) fail('not_found');
    const drawing = await findDrawingRecord(share.drawing_id);
    if (drawing === null) fail('not_found');
    const workspace = await findWorkspace(drawing.workspace_id);
    if (workspace === null) fail('not_found');
    const now = workspaceNow(workspace);
    assertLinkUsable(shareStatus(share, workspace, now));
    const expiresAt = linkExpiryInstant(share.expiry_date, workspace.time_zone);
    return json(200, {
      drawing: { id: drawing.id, name: drawing.name },
      access: share.access,
      status: 'active',
      expires_at: expiresAt === null ? null : expiresAt.toISOString(),
      time_zone: workspace.time_zone,
      expiry_label: expiryLabel(share, workspace),
    });
  });
}
