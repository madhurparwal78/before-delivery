import { createHash } from 'node:crypto';
import { config, appBaseUrl } from '../config.js';
import { query, queryOne } from '../db.js';
import { conflict, gone, notFound, storageUnavailable, validation } from '../http/errors.js';
import type { Ctx, Reply, Route } from '../http/router.js';
import type { MemberRow } from '../data/members.js';
import { photosFor, photosOf, profileView, type TalentRow } from '../data/talent.js';
import { getObject, putObject } from '../services/storage.js';
import { buildZip, type ZipEntry } from '../services/zip.js';
import { packageLinkEmail } from '../emails.js';
import { queueMail } from '../services/mail.js';
import { newId, newToken } from '../ids.js';
import { toIsoInstant } from '../../shared/zone.js';
import { cleanSingleLine, fieldCopy, json, readArray, readString, EMAIL_PATTERN, FieldErrors } from './helpers.js';
import type { PackageDecision, PackageRecord, PackageState, PackageView } from '../../shared/types.js';

type PackageRow = {
  id: string;
  title: string;
  recipient_name: string;
  recipient_email: string;
  state: PackageState;
  created_by: string;
};

type LinkRow = {
  token: string;
  package_id: string;
  issued_at: Date;
  expires_at: Date;
  status: 'active' | 'revoked' | 'replaced';
};

type PackageTalentRow = { package_id: string; talent_id: string; position: number; decision: PackageDecision };

async function currentLink(packageId: string): Promise<LinkRow> {
  const row = await queryOne<LinkRow>(
    `SELECT * FROM package_links WHERE package_id = $1 ORDER BY issued_at DESC LIMIT 1`,
    [packageId],
  );
  if (!row) throw notFound();
  return row;
}

async function packageTalent(packageId: string): Promise<Array<PackageTalentRow & { talent: TalentRow }>> {
  const entries = await query<PackageTalentRow>(
    'SELECT * FROM package_talent WHERE package_id = $1 ORDER BY position',
    [packageId],
  );
  if (entries.length === 0) return [];
  const talent = await query<TalentRow>('SELECT * FROM talent WHERE id = ANY($1::text[])', [
    entries.map((entry) => entry.talent_id),
  ]);
  return entries
    .map((entry) => {
      const row = talent.find((candidate) => candidate.id === entry.talent_id);
      return row ? { ...entry, talent: row } : null;
    })
    .filter((entry): entry is PackageTalentRow & { talent: TalentRow } => entry !== null);
}

async function packageView(row: PackageRow): Promise<PackageRecord> {
  const link = await currentLink(row.id);
  const entries = await packageTalent(row.id);
  return {
    id: row.id,
    title: row.title,
    recipientName: row.recipient_name,
    recipientEmail: row.recipient_email,
    state: row.state,
    url: `${appBaseUrl()}/p/${link.token}`,
    issuedAt: toIsoInstant(link.issued_at.getTime()),
    expiresAt: toIsoInstant(link.expires_at.getTime()),
    talent: entries.map((entry) => ({
      talentId: entry.talent_id,
      displayName: entry.talent.display_name,
      decision: entry.decision,
    })),
  };
}

async function issueLink(packageId: string, nowMs: number): Promise<string> {
  const token = newToken();
  await query(`UPDATE package_links SET status = 'replaced' WHERE package_id = $1 AND status = 'active'`, [
    packageId,
  ]);
  await query(
    `INSERT INTO package_links (token, package_id, issued_at, expires_at, status)
     VALUES ($1, $2, $3, $4, 'active')`,
    [token, packageId, new Date(nowMs), new Date(nowMs + config.packageLinkTtlSeconds * 1000)],
  );
  return token;
}

/** 410s of a link address are decided in one place. */
async function resolveLink(token: string, nowMs: number): Promise<{ pkg: PackageRow; link: LinkRow }> {
  const link = await queryOne<LinkRow>('SELECT * FROM package_links WHERE token = $1', [token]);
  if (!link) throw notFound();
  if (link.status === 'replaced') throw gone('link_replaced');
  if (link.status === 'revoked') throw gone('link_revoked');
  if (nowMs >= link.expires_at.getTime()) throw gone('link_expired');
  const pkg = await queryOne<PackageRow>('SELECT * FROM packages WHERE id = $1', [link.package_id]);
  if (!pkg) throw notFound();
  if (pkg.state === 'revoked') throw gone('link_revoked');
  return { pkg, link };
}

/** Withdrawn talent drop out of the view, the count and the ZIP at once. */
async function linkView(pkg: PackageRow, link: LinkRow): Promise<PackageView> {
  const entries = (await packageTalent(pkg.id)).filter((entry) => entry.talent.state === 'active');
  const photos = await photosFor(entries.map((entry) => entry.talent_id));
  return {
    title: pkg.title,
    expiresAt: toIsoInstant(link.expires_at.getTime()),
    shortlistedCount: entries.filter((entry) => entry.decision === 'shortlisted').length,
    talent: entries.map((entry) => ({
      ...profileView(entry.talent, photos.get(entry.talent_id) ?? []),
      decision: entry.decision,
    })),
  };
}

async function findPackage(id: string): Promise<PackageRow> {
  const row = await queryOne<PackageRow>('SELECT * FROM packages WHERE id = $1', [id]);
  if (!row) throw notFound();
  return row;
}

export const packageRoutes: Route[] = [
  {
    method: 'POST',
    path: '/api/packages',
    auth: 'session',
    roles: ['booker', 'agency_director'],
    body: 'json',
    handler: async (ctx: Ctx): Promise<Reply> => {
      const member = ctx.member as MemberRow;
      const fields = new FieldErrors();
      const title = cleanSingleLine(readString(ctx.json, 'title') ?? '');
      const recipientName = cleanSingleLine(readString(ctx.json, 'recipientName') ?? '');
      const recipientEmail = cleanSingleLine(readString(ctx.json, 'recipientEmail') ?? '');
      const talentIds = (readArray(ctx.json, 'talentIds') ?? []).map((value) => String(value));
      if (!title) fields.add('title', fieldCopy.required('Title'));
      if (!recipientName) fields.add('recipientName', fieldCopy.required('Recipient name'));
      if (!recipientEmail) fields.add('recipientEmail', fieldCopy.required('Recipient email'));
      else if (!EMAIL_PATTERN.test(recipientEmail)) fields.add('recipientEmail', fieldCopy.email());
      if (talentIds.length === 0) fields.add('talentIds', fieldCopy.required('Talent'));
      const talent = talentIds.length
        ? await query<TalentRow>('SELECT * FROM talent WHERE id = ANY($1::text[])', [talentIds])
        : [];
      if (talentIds.some((id) => !talent.some((row) => row.id === id && row.state === 'active'))) {
        fields.add('talentIds', 'Every talent in a package must be active.');
      }
      fields.throwIfAny();

      const id = newId('pkg');
      await query(
        `INSERT INTO packages (id, title, recipient_name, recipient_email, state, created_by)
         VALUES ($1, $2, $3, $4, 'active', $5)`,
        [id, title, recipientName, recipientEmail, member.id],
      );
      for (const [index, talentId] of talentIds.entries()) {
        await query(
          'INSERT INTO package_talent (package_id, talent_id, position) VALUES ($1, $2, $3)',
          [id, talentId, index],
        );
      }
      const token = await issueLink(id, ctx.nowMs);
      await queueMail(packageLinkEmail({ recipient: recipientEmail, recipientName, title, token }));
      return json(201, { package: await packageView(await findPackage(id)) });
    },
  },
  {
    method: 'GET',
    path: '/api/packages',
    auth: 'session',
    roles: ['booker', 'agency_director'],
    handler: async (): Promise<Reply> => {
      const rows = await query<PackageRow>('SELECT * FROM packages ORDER BY created_at DESC');
      const packages: PackageRecord[] = [];
      for (const row of rows) packages.push(await packageView(row));
      return json(200, { packages });
    },
  },
  {
    method: 'GET',
    path: '/api/packages/:id',
    auth: 'session',
    roles: ['booker', 'agency_director'],
    handler: async (ctx: Ctx): Promise<Reply> =>
      json(200, { package: await packageView(await findPackage(ctx.params.id)) }),
  },
  {
    method: 'POST',
    path: '/api/packages/:id/revoke',
    auth: 'session',
    roles: ['booker', 'agency_director'],
    body: 'json',
    load: async (ctx: Ctx): Promise<void> => {
      await findPackage(ctx.params.id);
    },
    handler: async (ctx: Ctx): Promise<Reply> => {
      const pkg = await findPackage(ctx.params.id);
      if (pkg.state === 'revoked') throw conflict('already_revoked');
      await query(`UPDATE packages SET state = 'revoked' WHERE id = $1`, [pkg.id]);
      await query(`UPDATE package_links SET status = 'revoked' WHERE package_id = $1 AND status = 'active'`, [
        pkg.id,
      ]);
      return json(200, { package: await packageView(await findPackage(pkg.id)) });
    },
  },
  {
    method: 'POST',
    path: '/api/packages/:id/regenerate',
    auth: 'session',
    roles: ['booker', 'agency_director'],
    body: 'json',
    load: async (ctx: Ctx): Promise<void> => {
      await findPackage(ctx.params.id);
    },
    handler: async (ctx: Ctx): Promise<Reply> => {
      const pkg = await findPackage(ctx.params.id);
      await query(`UPDATE packages SET state = 'active' WHERE id = $1`, [pkg.id]);
      await query(`UPDATE package_links SET status = 'replaced' WHERE package_id = $1 AND status <> 'replaced'`, [
        pkg.id,
      ]);
      const token = await issueLink(pkg.id, ctx.nowMs);
      await queueMail(
        packageLinkEmail({
          recipient: pkg.recipient_email,
          recipientName: pkg.recipient_name,
          title: pkg.title,
          token,
        }),
      );
      return json(200, { package: await packageView(await findPackage(pkg.id)) });
    },
  },
  {
    method: 'GET',
    path: '/api/p/:token',
    auth: 'public',
    handler: async (ctx: Ctx): Promise<Reply> => {
      const { pkg, link } = await resolveLink(ctx.params.token, ctx.nowMs);
      return json(200, await linkView(pkg, link));
    },
  },
  {
    method: 'PUT',
    path: '/api/p/:token/decisions/:slug',
    auth: 'public',
    body: 'json',
    handler: async (ctx: Ctx): Promise<Reply> => {
      const { pkg } = await resolveLink(ctx.params.token, ctx.nowMs);
      const entries = await packageTalent(pkg.id);
      const entry = entries.find((candidate) => candidate.talent.slug === ctx.params.slug);
      if (!entry || entry.talent.state !== 'active') throw notFound();
      const decision = readString(ctx.json, 'decision') ?? '';
      if (!['shortlisted', 'passed', 'undecided'].includes(decision)) {
        throw validation({ decision: 'Choose shortlisted, passed or undecided.' });
      }
      await query(
        'UPDATE package_talent SET decision = $3 WHERE package_id = $1 AND talent_id = $2',
        [pkg.id, entry.talent_id, decision],
      );
      const after = (await packageTalent(pkg.id)).filter((candidate) => candidate.talent.state === 'active');
      return json(200, {
        slug: ctx.params.slug,
        decision,
        shortlistedCount: after.filter((candidate) => candidate.decision === 'shortlisted').length,
      });
    },
  },
  {
    method: 'GET',
    path: '/api/p/:token/photos.zip',
    auth: 'public',
    handler: async (ctx: Ctx): Promise<Reply> => {
      const { pkg } = await resolveLink(ctx.params.token, ctx.nowMs);
      const entries = (await packageTalent(pkg.id)).filter((entry) => entry.talent.state === 'active');
      const files: Array<{ name: string; bytes: number; sha256: string }> = [];
      const zipEntries: ZipEntry[] = [];
      for (const entry of entries) {
        const photos = await photosOf(entry.talent_id);
        for (const [index, photo] of photos.entries()) {
          const bytes = await getObject(photo.object_key);
          if (!bytes) throw storageUnavailable();
          const name = `${entry.talent.slug}/${String(index + 1).padStart(2, '0')}.jpg`;
          zipEntries.push({ name, bytes });
          files.push({
            name,
            bytes: bytes.length,
            sha256: createHash('sha256').update(bytes).digest('hex'),
          });
        }
      }
      const manifest = {
        package: pkg.title,
        generatedAt: toIsoInstant(ctx.nowMs),
        files,
      };
      zipEntries.push({ name: 'manifest.json', bytes: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') });
      const zip = buildZip(zipEntries);
      await putObject(`packages/${pkg.id}/photos.zip`, zip, 'application/zip');
      return {
        status: 200,
        body: zip,
        contentType: 'application/zip',
        headers: { 'Content-Disposition': `attachment; filename="package-${pkg.id}.zip"` },
      };
    },
  },
];
