import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { config } from '../config.ts';
import { pool } from '../db/pool.ts';
import { appendAudit, auditChainHead } from '../domain/audit.ts';
import { linkState } from '../domain/linkState.ts';
import { buildCompletedPdf, type CompletedField } from '../pdf/complete.ts';
import { completedKey, getObject, originalKey, putObject } from '../services/storage.ts';
import { markStorageDown, recheckStorage } from '../services/health.ts';
import { isFieldComplete } from '../../shared/fields.ts';
import type { LinkState } from '../../shared/types.ts';
import {
  completedMail,
  declineMail,
  deliverAllOrHold,
  invitationMail,
  newLinkMail,
  voidMail,
  type Outgoing,
} from './mailer.ts';
import {
  currentRecipient,
  loadAggregate,
  recipientStatus,
  touchDocument,
  type Aggregate,
  type RecipientRow,
} from './document.ts';

export const tokenHash = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');

export const freshLinkToken = (): string => randomBytes(32).toString('base64url');

/** Issues a fresh secret for one recipient, replacing any link they had. */
export const issueLink = async (
  client: pg.PoolClient,
  documentId: string,
  recipientId: string,
  now: Date,
): Promise<{ token: string; expiresAt: Date }> => {
  await client.query('UPDATE links SET active = false WHERE recipient_id = $1 AND active', [
    recipientId,
  ]);
  const token = freshLinkToken();
  const expiresAt = new Date(now.getTime() + config.linkTtlSeconds * 1000);
  await client.query(
    `INSERT INTO links (id, document_id, recipient_id, token_hash, issued_at, expires_at, active)
     VALUES ($1, $2, $3, $4, $5, $6, true)`,
    [randomUUID(), documentId, recipientId, tokenHash(token), now, expiresAt],
  );
  return { token, expiresAt };
};

/** A recipient's turn begins: a link is issued and their invitation goes out. */
export const beginTurn = async (
  client: pg.PoolClient,
  aggregate: Aggregate,
  recipient: RecipientRow,
  now: Date,
): Promise<Outgoing> => {
  const { token } = await issueLink(client, aggregate.doc.id, recipient.id, now);
  await client.query(
    "UPDATE recipients SET status = 'invited', delivery = NULL WHERE id = $1",
    [recipient.id],
  );
  return invitationMail(
    aggregate.doc.id,
    recipient.id,
    recipient.email,
    aggregate.doc.title,
    aggregate.doc.owner_name,
    token,
  );
};

export const issueNewLink = async (
  client: pg.PoolClient,
  aggregate: Aggregate,
  recipient: RecipientRow,
  actorEmail: string,
  now: Date,
): Promise<Outgoing> => {
  const { token } = await issueLink(client, aggregate.doc.id, recipient.id, now);
  await client.query("UPDATE recipients SET status = 'invited', delivery = NULL WHERE id = $1", [
    recipient.id,
  ]);
  await appendAudit(client, {
    documentId: aggregate.doc.id,
    type: 'link.resent',
    actor: actorEmail,
    recipientId: recipient.id,
  });
  await touchDocument(client, aggregate.doc.id);
  return newLinkMail(
    aggregate.doc.id,
    recipient.id,
    recipient.email,
    aggregate.doc.title,
    aggregate.doc.owner_name,
    token,
  );
};

export interface LinkContext {
  aggregate: Aggregate;
  recipient: RecipientRow;
  state: LinkState;
}

export const resolveLink = async (
  token: string,
  client?: pg.PoolClient,
  now: Date = new Date(),
): Promise<LinkContext | null> => {
  const text = `SELECT document_id, recipient_id, active, expires_at FROM links WHERE token_hash = $1`;
  const rows = client
    ? (await client.query<{ document_id: string; recipient_id: string; active: boolean; expires_at: Date }>(text, [tokenHash(token)])).rows
    : (await pool.query<{ document_id: string; recipient_id: string; active: boolean; expires_at: Date }>(text, [tokenHash(token)])).rows;
  const link = rows[0];
  if (!link) return null;
  const aggregate = await loadAggregate(link.document_id, null, client);
  if (!aggregate) return null;
  const recipient = aggregate.recipients.find((row) => row.id === link.recipient_id);
  if (!recipient) return null;
  const current = currentRecipient(aggregate);
  const state = linkState({
    documentStatus: aggregate.doc.status,
    recipientStatus: recipientStatus(recipient, now),
    linkActive: link.active,
    linkExpired: link.expires_at.getTime() <= now.getTime(),
    isTurn: current !== null && current.id === recipient.id,
  });
  return { aggregate, recipient, state };
};

export const dateInZone = (at: Date, timeZone: string): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);

export const remainingRequired = (aggregate: Aggregate, recipientId: string): number =>
  aggregate.fields.filter(
    (field) =>
      field.recipient_id === recipientId &&
      field.required &&
      field.kind !== 'date' &&
      !isFieldComplete(field),
  ).length;

export interface SignResult {
  state: 'signed_waiting' | 'sealing';
  mails: Outgoing[];
  sealDocumentId: string | null;
}

/** Records one signature and, with it, either the next turn or the seal. */
export const recordSignature = async (
  client: pg.PoolClient,
  aggregate: Aggregate,
  recipient: RecipientRow,
  now: Date,
): Promise<SignResult> => {
  const documentId = aggregate.doc.id;
  const dateValue = dateInZone(now, aggregate.doc.time_zone);
  await client.query(
    `UPDATE fields SET value = $3 WHERE document_id = $1 AND recipient_id = $2 AND kind = 'date'`,
    [documentId, recipient.id, dateValue],
  );
  await client.query(
    "UPDATE recipients SET status = 'signed', signed_at = $2 WHERE id = $1",
    [recipient.id, now],
  );
  await appendAudit(client, {
    documentId,
    type: 'recipient.signed',
    actor: recipient.email,
    recipientId: recipient.id,
  });

  const next = aggregate.recipients.find((row) => row.order_index > recipient.order_index);
  if (next) {
    const invitation = await beginTurn(client, aggregate, next, now);
    await touchDocument(client, documentId);
    return { state: 'signed_waiting', mails: [invitation], sealDocumentId: null };
  }
  await client.query("UPDATE documents SET status = 'sealing' WHERE id = $1", [documentId]);
  await touchDocument(client, documentId);
  return { state: 'sealing', mails: [], sealDocumentId: documentId };
};

const closeLinks = async (client: pg.PoolClient, documentId: string): Promise<void> => {
  await client.query('UPDATE links SET active = false WHERE document_id = $1', [documentId]);
  await client.query('UPDATE recipients SET binding = false WHERE document_id = $1', [documentId]);
};

export const recordDecline = async (
  client: pg.PoolClient,
  aggregate: Aggregate,
  recipient: RecipientRow,
  reason: string,
  now: Date,
): Promise<Outgoing[]> => {
  const documentId = aggregate.doc.id;
  await client.query(
    "UPDATE recipients SET status = 'declined', decline_reason = $2 WHERE id = $1",
    [recipient.id, reason],
  );
  await client.query(
    `UPDATE documents SET status = 'declined', declined_by = $2, decline_reason = $3,
            reminder_available_at = NULL WHERE id = $1`,
    [documentId, recipient.id, reason],
  );
  await closeLinks(client, documentId);
  await appendAudit(client, {
    documentId,
    type: 'recipient.declined',
    actor: recipient.email,
    recipientId: recipient.id,
  });
  await touchDocument(client, documentId);
  void now;

  const notify = new Set<string>([aggregate.doc.owner_email]);
  for (const row of aggregate.recipients) {
    if (row.stored_status === 'signed') notify.add(row.email);
  }
  notify.delete(recipient.email);
  return [...notify].map((email) =>
    declineMail(documentId, email, aggregate.doc.title, reason),
  );
};

export const recordVoid = async (
  client: pg.PoolClient,
  aggregate: Aggregate,
  actorEmail: string,
  actorUserId: string,
  reason: string,
): Promise<Outgoing[]> => {
  const documentId = aggregate.doc.id;
  const current = currentRecipient(aggregate);
  await client.query(
    `UPDATE documents SET status = 'voided', voided_by = $2, void_reason = $3,
            reminder_available_at = NULL WHERE id = $1`,
    [documentId, actorUserId, reason],
  );
  await closeLinks(client, documentId);
  await appendAudit(client, {
    documentId,
    type: 'document.voided',
    actor: actorEmail,
    recipientId: null,
  });
  await touchDocument(client, documentId);

  const notify = new Set<string>([aggregate.doc.owner_email]);
  for (const row of aggregate.recipients) {
    if (row.stored_status === 'signed') notify.add(row.email);
  }
  if (current) notify.add(current.email);
  return [...notify].map((email) => voidMail(documentId, email, aggregate.doc.title, reason));
};

const completedFields = (aggregate: Aggregate): CompletedField[] =>
  aggregate.fields.map((field) => ({
    kind: field.kind,
    page: field.page,
    x: field.x,
    y: field.y,
    w: field.w,
    h: field.h,
    value: field.value,
    strokes: field.strokes,
  }));

const certificateStamp = (at: Date): string =>
  `${at.toISOString().slice(0, 10)} ${at.toISOString().slice(11, 16)}`;

/**
 * Seals the completed PDF. Only one instance works on a document at a time:
 * the document row stays locked for the whole attempt.
 */
export const attemptSeal = async (documentId: string): Promise<void> => {
  const client = await pool.connect();
  let completion: { title: string; sha: string; mails: Outgoing[] } | null = null;
  try {
    await client.query('BEGIN');
    const claim = await client.query<{ id: string }>(
      `SELECT id FROM documents WHERE id = $1 AND status = 'sealing'
       FOR UPDATE SKIP LOCKED`,
      [documentId],
    );
    if (claim.rows.length === 0) {
      await client.query('ROLLBACK');
      return;
    }
    const aggregate = await loadAggregate(documentId, null, client);
    if (!aggregate) {
      await client.query('ROLLBACK');
      return;
    }
    const chainHead = await auditChainHead(client, documentId);

    let bytes: Buffer;
    try {
      const original = await getObject(originalKey(documentId));
      if (original === null) throw new Error('original missing');
      bytes = buildCompletedPdf(original, completedFields(aggregate), {
        title: aggregate.doc.title,
        documentId,
        originalSha256: aggregate.doc.original_sha256,
        pageCount: aggregate.doc.page_count,
        signers: aggregate.recipients.map((row) => ({
          order: row.order_index,
          name: row.name,
          email: row.email,
          signedAt: certificateStamp(row.signed_at ?? new Date()),
        })),
        chainHead,
      });
      await putObject(completedKey(documentId), bytes);
    } catch (error) {
      markStorageDown();
      void recheckStorage();
      await client.query('UPDATE documents SET seal_failed_at = now() WHERE id = $1', [documentId]);
      await client.query('COMMIT');
      process.stderr.write(`seal attempt failed: ${String(error)}\n`);
      return;
    }

    const sha = createHash('sha256').update(bytes).digest('hex');
    await client.query(
      `UPDATE documents SET status = 'completed', completed_sha256 = $2, seal_failed_at = NULL
       WHERE id = $1`,
      [documentId, sha],
    );
    await appendAudit(client, { documentId, type: 'document.sealed', actor: 'system' });
    await appendAudit(client, { documentId, type: 'document.completed', actor: 'system' });
    await touchDocument(client, documentId);

    const mails: Outgoing[] = [];
    const seen = new Set<string>();
    const now = new Date();
    for (const row of aggregate.recipients) {
      if (seen.has(row.email)) continue;
      seen.add(row.email);
      const { token } = await issueLink(client, documentId, row.id, now);
      mails.push(
        completedMail(
          documentId,
          row.email,
          aggregate.doc.title,
          sha,
          `/sign/${token}/completed.pdf`,
        ),
      );
    }
    if (!seen.has(aggregate.doc.owner_email)) {
      mails.push(
        completedMail(
          documentId,
          aggregate.doc.owner_email,
          aggregate.doc.title,
          sha,
          `/api/documents/${documentId}/completed.pdf`,
        ),
      );
    }
    await client.query('COMMIT');
    completion = { title: aggregate.doc.title, sha, mails };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    process.stderr.write(`seal failed: ${String(error)}\n`);
  } finally {
    client.release();
  }
  if (completion) await deliverAllOrHold(completion.mails);
};

/** Serialises every write that can change a document's status. */
export const lockDocument = async (
  client: pg.PoolClient,
  documentId: string,
): Promise<void> => {
  await client.query('SELECT id FROM documents WHERE id = $1 FOR UPDATE', [documentId]);
};
