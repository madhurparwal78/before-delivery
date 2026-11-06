import { one, pool, query, withSerializable } from '../db/pool.js';
import {
  canReadCertificate,
  certificateJson,
  certificateJsonById,
  certificatesOfLearner,
  getCertificate,
  getVersions,
  searchCertificates,
  toVersionRows,
  transcriptTotalHundredths,
  type CertificateRow,
} from '../data/certificates.js';
import { provider } from '../db/seed.js';
import {
  certificateObjectKey,
  certificateState,
  currentVersion,
  reissuePending,
} from '../domain/certificate.js';
import { formatHours } from '../domain/contactHours.js';
import { hasExpired, plusSeconds, shareLinkState } from '../domain/expiry.js';
import { instantToIso } from '../domain/providerTime.js';
import { conflict, notFound, Validator } from '../http/errors.js';
import { param, requireUser, type Reply, type RequestContext } from '../http/context.js';
import type { Route } from '../http/router.js';
import { getObject } from '../services/storage.js';
import { trySealVersion } from '../services/sealing.js';
import { newId, randomToken } from '../util/ids.js';
import { config } from '../config.js';

const SEARCH_MESSAGE = 'Search with at most 100 characters.';
const REASON_MESSAGE = 'Give a reason of 1 to 500 characters.';

async function readableCertificate(ctx: RequestContext): Promise<CertificateRow> {
  const user = requireUser(ctx);
  const certificate = await getCertificate(pool, param(ctx, 'id'));
  if (certificate === null || !canReadCertificate(certificate, user)) throw notFound();
  return certificate;
}

async function ownCertificate(ctx: RequestContext): Promise<CertificateRow> {
  const user = requireUser(ctx);
  const certificate = await getCertificate(pool, param(ctx, 'id'));
  if (certificate === null || certificate.user_id !== user.id) throw notFound();
  return certificate;
}

async function readTranscript(ctx: RequestContext): Promise<Reply> {
  const user = requireUser(ctx);
  const rows = await certificatesOfLearner(pool, user.id);
  const certificates = [];
  for (const row of rows) certificates.push(await certificateJsonById(pool, row));
  return {
    status: 200,
    json: {
      certificates,
      total_hours: formatHours(await transcriptTotalHundredths(pool, rows)),
    },
  };
}

async function readCertificate(ctx: RequestContext): Promise<Reply> {
  const certificate = await readableCertificate(ctx);
  return { status: 200, json: { certificate: await certificateJsonById(pool, certificate) } };
}

async function pdfBytes(certificate: CertificateRow, version: number): Promise<Buffer> {
  return getObject(certificateObjectKey(provider().slug, certificate.serial, version));
}

/**
 * The signed download link needs no session and serves the version it was made for; the
 * session-backed download serves the current version.
 */
async function downloadPdf(ctx: RequestContext): Promise<Reply> {
  const token = ctx.query.get('token');
  const certificateId = param(ctx, 'id');

  if (token !== null) {
    const row = await one<{ certificate_id: string; version: number; expires_at: Date }>(
      pool,
      'SELECT certificate_id, version, expires_at FROM download_tokens WHERE token = $1',
      [token],
    );
    if (row === null || row.certificate_id !== certificateId || hasExpired(row.expires_at, ctx.at)) {
      throw notFound();
    }
    const certificate = await getCertificate(pool, certificateId);
    if (certificate === null) throw notFound();
    return {
      status: 200,
      body: await pdfBytes(certificate, row.version),
      contentType: 'application/pdf',
    };
  }

  const certificate = await readableCertificate(ctx);
  const versions = toVersionRows(await getVersions(pool, certificate.id));
  if (certificateState(versions) === 'sealing') throw conflict('pdf_pending');
  return {
    status: 200,
    body: await pdfBytes(certificate, currentVersion(versions).version),
    contentType: 'application/pdf',
  };
}

interface ShareLinkRow {
  readonly id: string;
  readonly token: string;
  readonly created_at: Date;
  readonly expires_at: Date;
  readonly revoked_at: Date | null;
}

function shareLinkJson(row: ShareLinkRow, at: Date): Record<string, unknown> {
  return {
    id: row.id,
    url: `/verify/${row.token}`,
    state: shareLinkState(row.expires_at, row.revoked_at, at),
    created_at: instantToIso(row.created_at),
    expires_at: instantToIso(row.expires_at),
  };
}

/** A certificate has at most one active link: creating one revokes the active one. */
async function createShareLink(ctx: RequestContext): Promise<Reply> {
  const certificate = await ownCertificate(ctx);
  const versions = toVersionRows(await getVersions(pool, certificate.id));
  if (certificateState(versions) !== 'sealed') throw conflict('certificate_not_sealed');
  new Validator(ctx.body, []).throwIfInvalid();

  const row = await withSerializable(async (client) => {
    const active = await query<ShareLinkRow>(
      client,
      `SELECT id, token, created_at, expires_at, revoked_at FROM share_links
       WHERE certificate_id = $1 AND revoked_at IS NULL AND expires_at > $2 FOR UPDATE`,
      [certificate.id, ctx.at],
    );
    for (const link of active) {
      await client.query('UPDATE share_links SET revoked_at = $2 WHERE id = $1', [link.id, ctx.at]);
    }
    const created: ShareLinkRow = {
      id: newId(),
      token: randomToken(32),
      created_at: ctx.at,
      expires_at: plusSeconds(ctx.at, config.shareLinkTtlSeconds),
      revoked_at: null,
    };
    await client.query(
      `INSERT INTO share_links (id, certificate_id, token, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [created.id, certificate.id, created.token, created.created_at, created.expires_at],
    );
    return created;
  });
  return { status: 201, json: { link: shareLinkJson(row, ctx.at) } };
}

async function listShareLinks(ctx: RequestContext): Promise<Reply> {
  const certificate = await ownCertificate(ctx);
  const rows = await query<ShareLinkRow>(
    pool,
    `SELECT id, token, created_at, expires_at, revoked_at FROM share_links
     WHERE certificate_id = $1 ORDER BY created_at`,
    [certificate.id],
  );
  return { status: 200, json: { links: rows.map((row) => shareLinkJson(row, ctx.at)) } };
}

async function revokeShareLink(ctx: RequestContext): Promise<Reply> {
  const certificate = await ownCertificate(ctx);
  const link = await one<ShareLinkRow>(
    pool,
    `SELECT id, token, created_at, expires_at, revoked_at FROM share_links
     WHERE id = $1 AND certificate_id = $2`,
    [param(ctx, 'linkId'), certificate.id],
  );
  if (link === null) throw notFound();
  new Validator(ctx.body, []).throwIfInvalid();
  if (shareLinkState(link.expires_at, link.revoked_at, ctx.at) === 'active') {
    await pool.query('UPDATE share_links SET revoked_at = $2 WHERE id = $1', [link.id, ctx.at]);
  }
  return { status: 204 };
}

async function plannerSearch(ctx: RequestContext): Promise<Reply> {
  const text = ctx.query.get('q') ?? '';
  const validator = new Validator(ctx.body, []);
  if (text.length > 100) validator.add('q', SEARCH_MESSAGE);
  validator.throwIfInvalid();
  const rows = await searchCertificates(pool, text);
  const certificates = [];
  for (const row of rows) certificates.push(await certificateJsonById(pool, row));
  return { status: 200, json: { certificates } };
}

function readReason(ctx: RequestContext): string {
  const validator = new Validator(ctx.body, ['reason']);
  const raw = ctx.body?.['reason'];
  const reason = typeof raw === 'string' ? raw.trim() : '';
  if (reason.length === 0 || reason.length > 500) validator.add('reason', REASON_MESSAGE);
  validator.throwIfInvalid();
  return reason;
}

/**
 * Reissue and revoke decisions are made one at a time against the state the previous
 * decision left, so of concurrent requests exactly one is accepted while a reissue is
 * still sealing or after a revoke.
 */
async function reissueCertificate(ctx: RequestContext): Promise<Reply> {
  const certificate = await getCertificate(pool, param(ctx, 'id'));
  if (certificate === null) throw notFound();

  const version = await withSerializable(async (client) => {
    const locked = await one<{ id: string }>(
      client,
      'SELECT id FROM certificates WHERE id = $1 FOR UPDATE',
      [certificate.id],
    );
    if (locked === null) throw notFound();
    const versions = toVersionRows(await getVersions(client, certificate.id));
    const state = certificateState(versions);
    if (state !== 'sealed') throw conflict('invalid_transition', { from: state, to: 'reissued' });
    if (reissuePending(versions)) throw conflict('reissue_pending');
    const reason = readReason(ctx);

    const nurse = await one<{ display_name: string }>(client, 'SELECT display_name FROM users WHERE id = $1', [
      certificate.user_id,
    ]);
    if (nurse === null) throw new Error('A certificate always has a nurse');
    const next = Math.max(...versions.map((entry) => entry.version)) + 1;
    await client.query(
      `INSERT INTO certificate_versions (id, certificate_id, version, state, nurse_name, reason, origin)
       VALUES ($1, $2, $3, 'sealing', $4, $5, $6)`,
      [newId(), certificate.id, next, nurse.display_name, reason, ctx.origin],
    );
    return next;
  });

  await trySealVersion(certificate.id, version);
  const versions = await getVersions(pool, certificate.id);
  const json = certificateJson(certificate, versions);
  return { status: json.reissue_pending ? 202 : 201, json: { certificate: json } };
}

async function revokeCertificate(ctx: RequestContext): Promise<Reply> {
  const certificate = await getCertificate(pool, param(ctx, 'id'));
  if (certificate === null) throw notFound();

  const json = await withSerializable(async (client) => {
    const locked = await one<{ id: string }>(
      client,
      'SELECT id FROM certificates WHERE id = $1 FOR UPDATE',
      [certificate.id],
    );
    if (locked === null) throw notFound();
    const versionRows = await getVersions(client, certificate.id);
    const versions = toVersionRows(versionRows);
    const state = certificateState(versions);
    if (state !== 'sealed') throw conflict('invalid_transition', { from: state, to: 'revoked' });
    if (reissuePending(versions)) throw conflict('reissue_pending');
    const reason = readReason(ctx);

    const current = currentVersion(versions);
    await client.query(
      `UPDATE certificate_versions SET state = 'revoked', reason = $3
       WHERE certificate_id = $1 AND version = $2`,
      [certificate.id, current.version, reason],
    );
    return certificateJson(certificate, await getVersions(client, certificate.id));
  });
  return { status: 200, json: { certificate: json } };
}

export const certificateRoutes: readonly Route[] = [
  { method: 'GET', path: '/api/me/transcript', auth: 'required', roles: ['learner'], handler: readTranscript },
  {
    method: 'GET',
    path: '/api/planner/certificates',
    auth: 'required',
    roles: ['planner'],
    handler: plannerSearch,
  },
  { method: 'GET', path: '/api/certificates/:id', auth: 'required', handler: readCertificate },
  { method: 'GET', path: '/api/certificates/:id/pdf', auth: 'token_or_session', handler: downloadPdf },
  {
    method: 'POST',
    path: '/api/certificates/:id/share-links',
    auth: 'required',
    roles: ['learner'],
    handler: createShareLink,
  },
  {
    method: 'GET',
    path: '/api/certificates/:id/share-links',
    auth: 'required',
    roles: ['learner'],
    handler: listShareLinks,
  },
  {
    method: 'DELETE',
    path: '/api/certificates/:id/share-links/:linkId',
    auth: 'required',
    roles: ['learner'],
    handler: revokeShareLink,
  },
  {
    method: 'POST',
    path: '/api/certificates/:id/reissue',
    auth: 'required',
    roles: ['planner'],
    handler: reissueCertificate,
  },
  {
    method: 'POST',
    path: '/api/certificates/:id/revoke',
    auth: 'required',
    roles: ['planner'],
    handler: revokeCertificate,
  },
];
