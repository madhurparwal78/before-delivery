import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { config, PROVIDER } from "./config.ts";
import { query, withTransaction } from "./db.ts";
import { putObject } from "./storage.ts";
import { buildCertificatePdf } from "./pdf.ts";
import { providerDateOf, displayDate } from "./time.ts";
import { pdfKey } from "./certificates.ts";
import { formatHours } from "./money.ts";

// Sealing: a version becomes sealed only after its PDF object exists; the email
// is queued exactly once after that.

export type SealingVersion = {
  certificate_id: string;
  version: number;
  serial: string;
  nurse_name: string;
  course_title: string;
  contact_hours_h: number;
  nurse_email: string;
  is_first_version: boolean;
};

export async function sealVersion(data: SealingVersion, origin: string): Promise<void> {
  const sealedOn = providerDateOf(new Date());
  const pdf = await buildCertificatePdf({
    nurseName: data.nurse_name,
    courseTitle: data.course_title,
    hours: formatHours(data.contact_hours_h),
    serial: data.serial,
    issuedOn: sealedOn,
    version: data.version,
    state: "sealed",
  });
  await putObject(pdfKey(data.serial, data.version), pdf, "application/pdf");

  await withTransaction(async (client) => {
    const { rows } = await client.query<{ current_version: number; issued_on: string | null }>(
      `SELECT current_version, to_char(issued_on,'YYYY-MM-DD') AS issued_on FROM certificates WHERE id = $1 FOR UPDATE`,
      [data.certificate_id],
    );
    const cert = rows[0];
    if (!cert) return;
    await client.query(
      `UPDATE certificate_versions SET state = 'sealed', sealed_on = $3 WHERE certificate_id = $1 AND version = $2`,
      [data.certificate_id, data.version, sealedOn],
    );
    if (!data.is_first_version) {
      await client.query(
        `UPDATE certificate_versions SET state = 'reissued' WHERE certificate_id = $1 AND version < $2 AND state = 'sealed'`,
        [data.certificate_id, data.version],
      );
    }
    const nextCurrent = Math.max(cert.current_version, data.version);
    await client.query(
      `UPDATE certificates SET state = 'sealed', current_version = $2, reissue_pending = false,
         issued_on = COALESCE(issued_on, $3) WHERE id = $1`,
      [data.certificate_id, nextCurrent, sealedOn],
    );
    await client.query(
      `UPDATE enrolments SET state = 'certified' WHERE id = (SELECT enrolment_id FROM certificates WHERE id = $1) AND state = 'completed'`,
      [data.certificate_id],
    );

    const token = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
    await client.query(
      `INSERT INTO download_tokens (token, certificate_id, version, expires_at)
       VALUES ($1, $2, $3, now() + make_interval(secs => $4))`,
      [token, data.certificate_id, data.version, config.timings.downloadLinkTtlSeconds],
    );
    const download = `${origin}/api/certificates/${data.certificate_id}/pdf?token=${token}`;
    const issuedOn = displayDate(providerDateOf(new Date()));
    const versionLine = data.is_first_version ? "" : `Version ${data.version}.`;
    const subject = data.is_first_version
      ? `Your Credwell certificate: ${data.course_title}`
      : `Your reissued Credwell certificate: ${data.course_title}`;
    const body = [
      `${data.nurse_name},`,
      ``,
      `${PROVIDER.name} has ${data.is_first_version ? "issued" : "reissued"} your certificate.`,
      ``,
      `Course: ${data.course_title}`,
      `Contact hours: ${formatHours(data.contact_hours_h)}`,
      `Serial: ${data.serial}`,
      `Issue date: ${issuedOn}`,
      versionLine,
      `Download your certificate PDF: ${download}`,
      ``,
      `This certificate can be verified with a share link from your Credwell transcript.`,
    ]
      .filter((l) => l !== "")
      .join("\n");
    await client.query(
      `INSERT INTO email_outbox (id, to_email, subject, body) VALUES (gen_random_uuid(), $1, $2, $3)`,
      [data.nurse_email, subject, body],
    );
  });
}

/** Retries storing every sealing version on the seal-retry cadence. */
export async function runSealRetryLoop(): Promise<void> {
  for (;;) {
    const wait = new Promise((resolve) => setTimeout(resolve, config.timings.sealRetrySeconds * 1000));
    try {
      const { rows } = await query<SealingVersion & { origin: string }>(
        `SELECT cv.certificate_id, cv.version, c.serial, cv.nurse_name, co.title AS course_title,
                c.contact_hours_h, u.email AS nurse_email, cv.version = 1 AS is_first_version, c.origin
           FROM certificate_versions cv
           JOIN certificates c ON c.id = cv.certificate_id
           JOIN enrolments e ON e.id = c.enrolment_id
           JOIN courses co ON co.id = e.course_id
           JOIN users u ON u.id = c.nurse_id
          WHERE cv.state = 'sealing'`,
      );
      for (const row of rows) {
        try {
          await sealVersion(row, row.origin === "" ? "http://127.0.0.1:4173" : row.origin);
        } catch (e) {
          // storage still down; try again on the next pass
          console.warn("seal retry failed", (e as Error).message);
        }
      }
    } catch {
      // database hiccup; try again on the next pass
    }
    await wait;
  }
}

export async function retrySealingNow(): Promise<void> {
  const { rows } = await query<SealingVersion & { origin: string }>(
    `SELECT cv.certificate_id, cv.version, c.serial, cv.nurse_name, co.title AS course_title,
            c.contact_hours_h, u.email AS nurse_email, cv.version = 1 AS is_first_version, c.origin
       FROM certificate_versions cv
       JOIN certificates c ON c.id = cv.certificate_id
       JOIN enrolments e ON e.id = c.enrolment_id
       JOIN courses co ON co.id = e.course_id
       JOIN users u ON u.id = c.nurse_id
      WHERE cv.state = 'sealing'`,
  );
  for (const row of rows) {
    try {
      await sealVersion(row, row.origin === "" ? "http://127.0.0.1:4173" : row.origin);
    } catch {
      // storage still down
    }
  }
}

export type SealClient = PoolClient;
