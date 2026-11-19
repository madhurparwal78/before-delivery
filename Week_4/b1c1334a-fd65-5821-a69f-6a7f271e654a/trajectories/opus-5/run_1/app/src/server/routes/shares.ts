import type { ShareJson } from '../../shared/api.js';
import { fieldMessages } from '../../shared/copy.js';
import { config } from '../config.js';
import { newId, withTransaction } from '../db.js';
import { forbidden, inviteAlreadySent, invalid, mailUnavailable, notFound } from '../errors.js';
import { asObject, asString } from '../json.js';
import { documentAccess } from '../load.js';
import { sendInvite } from '../smtp.js';
import { isValidEmail } from '../validate.js';
import type { Reply, RouteContext } from './types.js';

type ShareRow = {
  id: string;
  email: string;
  role: 'editor' | 'viewer';
  row_scope: 'all' | 'own';
  invite_status: 'sent' | 'not_sent';
};

function shareJson(row: ShareRow): ShareJson {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    row_scope: row.row_scope,
    invite_status: row.invite_status,
  };
}

export async function listShares(context: RouteContext): Promise<Reply> {
  const documentId = context.params['doc'] as string;
  const access = await documentAccess(context.client, documentId, context.account);
  if (access === null) throw notFound();
  const result = await context.client.query<ShareRow>(
    `select id, email, role, row_scope, invite_status from shares
     where document_id = $1 order by seq`,
    [documentId],
  );
  return { status: 200, body: { shares: result.rows.map(shareJson) } };
}

export async function createShare(context: RouteContext): Promise<Reply> {
  const documentId = context.params['doc'] as string;
  const access = await documentAccess(context.client, documentId, context.account);
  if (access === null) throw notFound();
  if (access.role !== 'owner') throw forbidden();

  const body = asObject(context.request.body) ?? {};
  const emailSent = asString(body['email']);
  const role = asString(body['role']);
  const rowScope = asString(body['row_scope']);
  if (emailSent === null || !isValidEmail(emailSent)) {
    throw invalid({ email: fieldMessages.email });
  }
  const email = emailSent.toLowerCase();
  if (email === context.account.email.toLowerCase()) {
    throw invalid({ email: fieldMessages.ownDocument });
  }
  if (role !== 'editor' && role !== 'viewer') throw invalid({ role: 'Choose Editor or Viewer.' });
  if (rowScope !== 'all' && rowScope !== 'own') {
    throw invalid({ row_scope: 'Choose all rows or only their own rows.' });
  }

  const document = await context.client.query<{ name: string }>(
    'select name from documents where id = $1',
    [documentId],
  );
  const documentName = document.rows[0]?.name ?? '';

  const existing = await context.client.query<ShareRow>(
    'select id, email, role, row_scope, invite_status from shares where document_id = $1 and email = $2',
    [documentId, email],
  );
  const sent = await sendInvite({
    to: email,
    sharerName: context.account.display_name,
    documentName,
    role: role === 'editor' ? 'Editor' : 'Viewer',
    documentUrl: `${config.publicUrl}/d/${documentId}`,
  });
  const inviteStatus = sent ? 'sent' : 'not_sent';

  const current = existing.rows[0];
  if (current !== undefined) {
    const updated = await context.client.query<ShareRow>(
      `update shares set role = $2, row_scope = $3, invite_status = $4
       where id = $1 returning id, email, role, row_scope, invite_status`,
      [current.id, role, rowScope, inviteStatus],
    );
    return { status: 200, body: { share: shareJson(updated.rows[0] as ShareRow) } };
  }
  const created = await context.client.query<ShareRow>(
    `insert into shares (id, document_id, email, role, row_scope, invite_status)
     values ($1, $2, $3, $4, $5, $6)
     returning id, email, role, row_scope, invite_status`,
    [newId('shr'), documentId, email, role, rowScope, inviteStatus],
  );
  return { status: 201, body: { share: shareJson(created.rows[0] as ShareRow) } };
}

export async function resendInvite(context: RouteContext): Promise<Reply> {
  const documentId = context.params['doc'] as string;
  const access = await documentAccess(context.client, documentId, context.account);
  if (access === null) throw notFound();
  if (access.role !== 'owner') throw forbidden();

  return withTransaction(context.client, async () => {
    const locked = await context.client.query<ShareRow & { document_name: string }>(
      `select s.id, s.email, s.role, s.row_scope, s.invite_status, d.name as document_name
       from shares s join documents d on d.id = s.document_id
       where s.id = $1 and s.document_id = $2 for update of s`,
      [context.params['share'], documentId],
    );
    const share = locked.rows[0];
    if (share === undefined) throw notFound();
    if (share.invite_status === 'sent') throw inviteAlreadySent();
    const sent = await sendInvite({
      to: share.email,
      sharerName: context.account.display_name,
      documentName: share.document_name,
      role: share.role === 'editor' ? 'Editor' : 'Viewer',
      documentUrl: `${config.publicUrl}/d/${documentId}`,
    });
    if (!sent) throw mailUnavailable();
    const updated = await context.client.query<ShareRow>(
      `update shares set invite_status = 'sent' where id = $1
       returning id, email, role, row_scope, invite_status`,
      [share.id],
    );
    return { status: 200, body: { share: shareJson(updated.rows[0] as ShareRow) } };
  });
}
