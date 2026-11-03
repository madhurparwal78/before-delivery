import { randomUUID } from 'node:crypto';
import { CredentialRecord, CredentialType } from '../../shared/types';
import { Db, query, queryOne, withTransaction } from '../db/pool';
import { notFound } from '../http/errors';
import { queueEmail } from '../services/mail';
import { credentialWarningEmail } from '../services/notifications';
import { credentialScanKey, putObject } from '../services/storage';
import { agencyDateOf } from '../../shared/time';
import { writeAudit } from './audit';
import { CREDENTIAL_WARNING_DAYS, credentialStatus } from './rules';

interface CredentialRow {
  id: string;
  type: CredentialType;
  number: string;
  expires_on: string;
}

export async function listCredentials(
  db: Db,
  interpreterId: string,
  now: Date,
): Promise<CredentialRecord[]> {
  const rows = await query<CredentialRow>(
    db,
    `select id, type, number, expires_on from credentials
     where interpreter_id = $1 order by expires_on desc, type`,
    [interpreterId],
  );
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    number: row.number,
    expires_on: row.expires_on,
    status: credentialStatus(row.expires_on, now),
  }));
}

export interface ScanUpload {
  filename: string;
  contentType: string;
  bytes: Buffer;
}

export async function addCredential(input: {
  interpreterId: string;
  type: CredentialType;
  number: string;
  expiresOn: string;
  scan: ScanUpload;
  now: Date;
}): Promise<CredentialRecord> {
  const id = randomUUID();
  const key = credentialScanKey(input.interpreterId, id, input.scan.filename);
  await putObject(key, input.scan.bytes, input.scan.contentType);

  await withTransaction(async (client) => {
    await client.query(
      `insert into credentials
         (id, interpreter_id, type, number, expires_on, scan_key, scan_filename, scan_content_type)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        input.interpreterId,
        input.type,
        input.number,
        input.expiresOn,
        key,
        input.scan.filename,
        input.scan.contentType,
      ],
    );
    await writeAudit(client, {
      actorId: input.interpreterId,
      action: 'credential.added',
      entity: 'credential',
      entityId: id,
      requestId: null,
      detail: { type: input.type, number: input.number, expires_on: input.expiresOn },
    });
  });

  await warnExpiringCredentials(input.now);

  return {
    id,
    type: input.type,
    number: input.number,
    expires_on: input.expiresOn,
    status: credentialStatus(input.expiresOn, input.now),
  };
}

export interface ScanLocation {
  objectKey: string;
  filename: string;
  contentType: string;
  interpreterId: string;
}

export async function loadScan(db: Db, credentialId: string): Promise<ScanLocation> {
  if (!/^[0-9a-f-]{36}$/i.test(credentialId)) throw notFound();
  const row = await queryOne<{
    scan_key: string;
    scan_filename: string;
    scan_content_type: string;
    interpreter_id: string;
  }>(
    db,
    'select scan_key, scan_filename, scan_content_type, interpreter_id from credentials where id = $1',
    [credentialId],
  );
  if (!row) throw notFound();
  return {
    objectKey: row.scan_key,
    filename: row.scan_filename,
    contentType: row.scan_content_type,
    interpreterId: row.interpreter_id,
  };
}

/** Exactly one warning email per credential, once its expiry is inside the warning period. */
export async function warnExpiringCredentials(now: Date): Promise<number> {
  const today = agencyDateOf(now);
  const edge = agencyDateOf(new Date(now.getTime() + CREDENTIAL_WARNING_DAYS * 86400000));
  return withTransaction(async (client) => {
    const due = await query<{
      id: string;
      type: CredentialType;
      number: string;
      expires_on: string;
      name: string;
      email: string;
    }>(
      client,
      `select c.id, c.type, c.number, c.expires_on, u.name, u.email
       from credentials c
       join users u on u.id = c.interpreter_id
       where c.expires_on >= $1 and c.expires_on <= $2
       order by c.id`,
      [today, edge],
    );
    for (const credential of due) {
      await queueEmail(client, {
        dedupeKey: `credential-warning-${credential.id}`,
        ...credentialWarningEmail({
          interpreterName: credential.name,
          interpreterEmail: credential.email,
          type: credential.type,
          number: credential.number,
          expiresOn: credential.expires_on,
        }),
      });
    }
    return due.length;
  });
}
