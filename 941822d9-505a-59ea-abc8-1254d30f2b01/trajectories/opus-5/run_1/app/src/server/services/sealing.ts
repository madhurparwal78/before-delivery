import { one, query, withTransaction, type Queryable } from '../db/pool.js';
import { provider } from '../db/seed.js';
import { certificateObjectKey } from '../domain/certificate.js';
import { formatHours } from '../domain/contactHours.js';
import { plusSeconds } from '../domain/expiry.js';
import { providerDate } from '../domain/providerTime.js';
import { newId, randomToken } from '../util/ids.js';
import { queueEmail } from '../data/outbox.js';
import { certificateIssued, certificateReissued } from './emails.js';
import { renderCertificatePdf } from './pdf.js';
import { putObject, StorageUnavailableError } from './storage.js';
import { config } from '../config.js';

interface SealingVersionRow {
  readonly certificate_id: string;
  readonly version: number;
  readonly nurse_name: string;
  readonly origin: string;
  readonly serial: string;
  readonly contact_hours_hundredths: number;
  readonly enrolment_id: string;
  readonly course_title: string;
  readonly nurse_email: string;
  readonly first_sealed_on: string | null;
}

const SEALING_SELECT = `
  SELECT cv.certificate_id, cv.version, cv.nurse_name, cv.origin,
         ce.serial, ce.contact_hours_hundredths, ce.enrolment_id,
         c.title AS course_title, u.email AS nurse_email,
         (SELECT sealed_on FROM certificate_versions WHERE certificate_id = ce.id AND version = 1) AS first_sealed_on
  FROM certificate_versions cv
  JOIN certificates ce ON ce.id = cv.certificate_id
  JOIN enrolments e ON e.id = ce.enrolment_id
  JOIN courses c ON c.id = e.course_id
  JOIN users u ON u.id = ce.user_id
  WHERE cv.state = 'sealing'
`;

async function pendingVersion(
  client: Queryable,
  certificateId: string,
  version: number,
): Promise<SealingVersionRow | null> {
  return one<SealingVersionRow>(
    client,
    `${SEALING_SELECT} AND cv.certificate_id = $1 AND cv.version = $2`,
    [certificateId, version],
  );
}

async function allPendingVersions(client: Queryable): Promise<SealingVersionRow[]> {
  return query<SealingVersionRow>(client, `${SEALING_SELECT} ORDER BY cv.created_at`);
}

function downloadUrl(origin: string, certificateId: string, token: string): string {
  return `${origin}/api/certificates/${certificateId}/pdf?token=${token}`;
}

/**
 * A version becomes sealed only after its PDF object exists; its email is queued in the
 * same transaction that seals it, so it goes out exactly once and never before the PDF.
 */
export async function sealVersion(certificateId: string, version: number): Promise<boolean> {
  const pending = await withTransaction((client) => pendingVersion(client, certificateId, version));
  if (pending === null) return false;

  const sealedOn = providerDate(new Date());
  const issuedOn = version === 1 ? sealedOn : pending.first_sealed_on ?? sealedOn;
  const pdf = renderCertificatePdf({
    serial: pending.serial,
    nurseName: pending.nurse_name,
    courseTitle: pending.course_title,
    contactHours: formatHours(pending.contact_hours_hundredths),
    issuedOn,
    state: 'sealed',
    provider: provider().name,
    accreditationStatement: provider().accreditationStatement,
    version: pending.version,
  });
  await putObject(certificateObjectKey(provider().slug, pending.serial, version), pdf, 'application/pdf');

  return withTransaction(async (client) => {
    const stillSealing = await one<{ id: string }>(
      client,
      `SELECT id FROM certificate_versions
       WHERE certificate_id = $1 AND version = $2 AND state = 'sealing' FOR UPDATE`,
      [certificateId, version],
    );
    if (stillSealing === null) return false;

    if (version > 1) {
      await client.query(
        `UPDATE certificate_versions SET state = 'reissued'
         WHERE certificate_id = $1 AND state = 'sealed'`,
        [certificateId],
      );
    }
    await client.query(
      `UPDATE certificate_versions SET state = 'sealed', sealed_on = $3, sealed_at = now()
       WHERE certificate_id = $1 AND version = $2`,
      [certificateId, version, sealedOn],
    );
    if (version === 1) {
      await client.query(
        `UPDATE enrolments SET state = 'certified' WHERE id = $1 AND state = 'completed'`,
        [pending.enrolment_id],
      );
    }

    const token = randomToken(32);
    const createdAt = new Date();
    await client.query(
      `INSERT INTO download_tokens (id, certificate_id, version, token, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        newId(),
        certificateId,
        version,
        token,
        createdAt,
        plusSeconds(createdAt, config.downloadLinkTtlSeconds),
      ],
    );

    const emailInput = {
      to: pending.nurse_email,
      nurseName: pending.nurse_name,
      courseTitle: pending.course_title,
      contactHours: formatHours(pending.contact_hours_hundredths),
      serial: pending.serial,
      issuedOn,
      downloadUrl: downloadUrl(pending.origin, certificateId, token),
      certificateId,
      version,
    };
    await queueEmail(client, version === 1 ? certificateIssued(emailInput) : certificateReissued(emailInput));
    return true;
  });
}

/** Tries to seal a version now; a storage outage leaves it in sealing for the retry loop. */
export async function trySealVersion(certificateId: string, version: number): Promise<boolean> {
  try {
    return await sealVersion(certificateId, version);
  } catch (error) {
    if (error instanceof StorageUnavailableError) return false;
    throw error;
  }
}

export function startSealRetryLoop(): NodeJS.Timeout {
  const timer = setInterval(() => {
    void (async () => {
      const pending = await withTransaction((client) => allPendingVersions(client));
      for (const row of pending) {
        await trySealVersion(row.certificate_id, row.version);
      }
    })().catch(() => {
      // Storage is still unreachable; the next tick tries again.
    });
  }, config.sealRetrySeconds * 1000);
  timer.unref();
  return timer;
}
