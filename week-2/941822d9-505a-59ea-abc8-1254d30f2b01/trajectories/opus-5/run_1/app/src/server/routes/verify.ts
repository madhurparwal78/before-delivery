import { one, pool } from '../db/pool.js';
import { getCertificate, getVersions, toVersionRows } from '../data/certificates.js';
import { provider } from '../db/seed.js';
import {
  certificateObjectKey,
  certificateState,
  currentVersion,
  issuedOn,
} from '../domain/certificate.js';
import { certificateCopy } from '../domain/certificateCopy.js';
import { formatHours } from '../domain/contactHours.js';
import { shareLinkState } from '../domain/expiry.js';
import { notFound } from '../http/errors.js';
import { param, type Reply, type RequestContext } from '../http/context.js';
import type { Route } from '../http/router.js';
import { getObject } from '../services/storage.js';

interface LinkRow {
  readonly certificate_id: string;
  readonly expires_at: Date;
  readonly revoked_at: Date | null;
}

/** A revoked, replaced or expired link stops working on the very next request. */
async function activeLink(token: string, at: Date): Promise<LinkRow> {
  const link = await one<LinkRow>(
    pool,
    'SELECT certificate_id, expires_at, revoked_at FROM share_links WHERE token = $1',
    [token],
  );
  if (link === null || shareLinkState(link.expires_at, link.revoked_at, at) !== 'active') throw notFound();
  return link;
}

async function readVerification(ctx: RequestContext): Promise<Reply> {
  const link = await activeLink(param(ctx, 'token'), ctx.at);
  const certificate = await getCertificate(pool, link.certificate_id);
  if (certificate === null) throw notFound();
  const versions = toVersionRows(await getVersions(pool, certificate.id));
  const state = certificateState(versions);
  if (state === 'sealing') throw notFound();
  const current = currentVersion(versions);
  return {
    status: 200,
    json: {
      certificate: certificateCopy({
        serial: certificate.serial,
        nurseName: current.nurseName,
        courseTitle: certificate.course_title,
        contactHours: formatHours(certificate.contact_hours_hundredths),
        issuedOn: issuedOn(versions),
        state,
        provider: provider().name,
        accreditationStatement: provider().accreditationStatement,
        version: current.version,
      }),
    },
  };
}

/** A link to a certificate that was revoked later shows the status but serves no PDF. */
async function readVerificationPdf(ctx: RequestContext): Promise<Reply> {
  const link = await activeLink(param(ctx, 'token'), ctx.at);
  const certificate = await getCertificate(pool, link.certificate_id);
  if (certificate === null) throw notFound();
  const versions = toVersionRows(await getVersions(pool, certificate.id));
  if (certificateState(versions) !== 'sealed') throw notFound();
  const body = await getObject(
    certificateObjectKey(provider().slug, certificate.serial, currentVersion(versions).version),
  );
  return { status: 200, body, contentType: 'application/pdf' };
}

export const verifyRoutes: readonly Route[] = [
  { method: 'GET', path: '/api/verify/:token', auth: 'public', handler: readVerification },
  { method: 'GET', path: '/api/verify/:token/pdf', auth: 'public', handler: readVerificationPdf },
];
