import type { FieldError, Share } from '../../shared/types.js';
import { requireNotebook, requireOwner } from '../access.js';
import { query, queryOne, withTransaction } from '../db.js';
import { conflict, mailUnavailable, notFound, validationFailed } from '../errors.js';
import { endStreamsForUser } from '../events.js';
import { readJsonBody, route, sendEmpty, sendJson, type Ctx } from '../http.js';
import { newId, newToken } from '../ids.js';
import { invitationMessage, MailFailure, sendMail } from '../mail.js';
import { scheduleSearchSync } from '../notebookstore.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function registerShareRoutes(): void {
  route('GET', '/api/notebooks/:id/shares', async (ctx: Ctx) => {
    const access = await requireNotebook(ctx, ctx.params.id);
    requireOwner(access);
    const shares = await query<Share>(
      `select s.id, s.email, u.display_name, s.role, s.status
         from shares s left join users u on u.id = s.user_id
        where s.notebook_id = $1
        order by s.created_at asc`,
      [access.notebook.id],
    );
    sendJson(ctx, 200, { shares });
  });

  route('POST', '/api/notebooks/:id/shares', async (ctx: Ctx) => {
    const access = await requireNotebook(ctx, ctx.params.id);
    requireOwner(access);
    const body = await readJsonBody(ctx);
    const email = (typeof body.email === 'string' ? body.email : '').trim();
    const emailLower = email.toLowerCase();
    const role = body.role;

    const existing = await queryOne<{ id: string }>(
      `select id from shares where notebook_id = $1 and email_lower = $2`,
      [access.notebook.id, emailLower],
    );
    if (existing) throw conflict('already_shared');

    const errors: FieldError[] = [];
    if (!EMAIL_PATTERN.test(email)) errors.push({ path: 'email', message: 'must be a valid email address' });
    else if (emailLower === access.user.email_lower) errors.push({ path: 'email', message: 'is the owner' });
    if (role !== 'editor' && role !== 'viewer') {
      errors.push({ path: 'role', message: 'must be "editor" or "viewer"' });
    }
    if (errors.length > 0) throw validationFailed(errors);

    const shareId = newId();
    const token = newToken();
    const invited = await queryOne<{ id: string }>(`select id from users where email_lower = $1`, [emailLower]);
    try {
      await withTransaction(async (client) => {
        await client.query(
          `insert into shares (id, notebook_id, email, email_lower, role, status, token)
           values ($1, $2, $3, $4, $5, 'invited', $6)`,
          [shareId, access.notebook.id, email, emailLower, role, token],
        );
        await sendMail(
          invitationMessage(
            email,
            access.user.display_name,
            access.notebook.title,
            role as 'editor' | 'viewer',
            token,
          ),
        );
      });
    } catch (error) {
      if (error instanceof MailFailure) throw mailUnavailable();
      throw error;
    }
    const displayName = invited
      ? (
          await queryOne<{ display_name: string }>(`select display_name from users where id = $1`, [invited.id])
        )?.display_name ?? null
      : null;
    sendJson(ctx, 201, {
      share: { id: shareId, email, display_name: displayName, role, status: 'invited' },
    });
  });

  route('DELETE', '/api/notebooks/:id/shares/:shareId', async (ctx: Ctx) => {
    const access = await requireNotebook(ctx, ctx.params.id);
    requireOwner(access);
    const removed = await queryOne<{ user_id: string | null }>(
      `delete from shares where id = $1 and notebook_id = $2 returning user_id`,
      [ctx.params.shareId, access.notebook.id],
    );
    if (!removed) throw notFound();
    if (removed.user_id) endStreamsForUser(access.notebook.id, removed.user_id);
    scheduleSearchSync(access.notebook.id);
    sendEmpty(ctx, 204);
  });
}
