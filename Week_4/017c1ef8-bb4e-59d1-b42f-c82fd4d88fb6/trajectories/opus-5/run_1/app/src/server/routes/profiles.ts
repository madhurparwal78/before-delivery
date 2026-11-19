import { connectionPath, degreeBetween, mutualConnections } from '../../domain/graph';
import {
  educationOf,
  experienceOf,
  memberById,
  memberByHandle,
  personCard,
  profileProjection,
  skillsFor,
  type MemberRow,
} from '../../domain/members';
import { notify, removeNotificationActor } from '../../domain/notifications';
import { businessNow } from '../clock';
import { config, MAX_FEATURED_SKILLS } from '../config';
import { query, transact } from '../db';
import { conflict, forbidden, namedValidation, notFound, storageUnavailable, validation } from '../errors';
import { detectPhotoType, isPdf, stripPhotoMetadata } from '../images';
import { newId } from '../ids';
import { jsonBody, requireMember, type Ctx } from '../http';
import { pushTo } from '../live';
import { readUpload } from '../multipart';
import { getObject, headObjectSize, putObject, StorageUnavailable } from '../storage';
import { createHash } from 'node:crypto';

const SECTIONS = ['intro', 'about', 'experience', 'education', 'skills'] as const;
type Section = (typeof SECTIONS)[number];

async function requireVisibleProfile(viewerId: string, handle: string): Promise<MemberRow> {
  const owner = await memberByHandle(handle);
  if (!owner) throw notFound();
  const projection = await profileProjection(viewerId, owner);
  if (!projection) throw notFound();
  return owner;
}

export async function getProfile(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const viewerId = requireMember(ctx);
  const owner = await memberByHandle(ctx.params.handle);
  if (!owner) throw notFound();
  const projection = await profileProjection(viewerId, owner);
  if (!projection) throw notFound();
  return { status: 200, body: projection };
}

export async function getMutual(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const viewerId = requireMember(ctx);
  const owner = await requireVisibleProfile(viewerId, ctx.params.handle);
  const mutual = await mutualConnections(viewerId, owner.id);
  const members: Record<string, unknown>[] = [];
  for (const entry of mutual) {
    const member = await memberById(entry.id);
    if (member) members.push(await personCard(viewerId, member));
  }
  return { status: 200, body: { count: mutual.length, members } };
}

export async function getPath(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const viewerId = requireMember(ctx);
  const owner = await requireVisibleProfile(viewerId, ctx.params.handle);
  const path = await connectionPath(viewerId, owner.id);
  const out: Record<string, unknown>[] = [];
  for (const step of path) {
    const member = await memberById(step.id);
    const hidden =
      member !== null &&
      member.visibility === 'private' &&
      (await degreeBetween(viewerId, member.id)) !== '1';
    out.push(hidden ? { private: true } : { id: step.id, name: step.name, handle: step.handle });
  }
  return { status: 200, body: { path: out } };
}

function monthPattern(value: unknown): boolean {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

async function sectionCurrent(member: MemberRow, section: Section): Promise<Record<string, unknown>> {
  switch (section) {
    case 'intro':
      return { name: member.name, headline: member.headline, location: member.location };
    case 'about':
      return { about: member.about };
    case 'experience':
      return { experience: await experienceOf(member.id) };
    case 'education':
      return { education: await educationOf(member.id) };
    case 'skills': {
      const skills = await skillsFor(member.id, member.id);
      return {
        skills: skills.map((skill) => skill.name),
        featured: skills
          .filter((skill) => skill.featured_position !== null)
          .sort((a, b) => (a.featured_position ?? 0) - (b.featured_position ?? 0))
          .map((skill) => skill.name),
      };
    }
  }
}

export async function patchSection(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const memberId = requireMember(ctx);
  const section = ctx.params.section as Section;
  if (!SECTIONS.includes(section)) throw notFound();
  const member = await memberById(memberId);
  if (!member) throw notFound();
  const body = jsonBody(ctx);
  const sent = Number(body.version);
  const currentVersion = member.versions[section] ?? 1;
  if (!Number.isFinite(sent) || sent !== currentVersion) {
    throw conflict('version_conflict', {
      section,
      current_version: currentVersion,
      current: await sectionCurrent(member, section),
    });
  }

  if (section === 'intro') {
    const name = String(body.name ?? '').trim();
    const headline = String(body.headline ?? '');
    const location = String(body.location ?? '');
    const fields: Record<string, string> = {};
    if (name.length < 1 || name.length > 80) fields.name = 'Enter a name of 1 to 80 characters.';
    if (headline.length > 120) fields.headline = 'Keep the headline under 120 characters.';
    if (location.length > 80) fields.location = 'Keep the location under 80 characters.';
    if (Object.keys(fields).length > 0) throw validation(fields);
    await query('UPDATE members SET name = $2, headline = $3, location = $4 WHERE id = $1', [
      memberId,
      name,
      headline,
      location,
    ]);
  } else if (section === 'about') {
    const about = String(body.about ?? '');
    if ([...about].length > 2000) throw validation({ about: 'Keep About under 2,000 characters.' });
    await query('UPDATE members SET about = $2 WHERE id = $1', [memberId, about]);
  } else if (section === 'experience') {
    const list = Array.isArray(body.experience) ? body.experience : [];
    const fields: Record<string, string> = {};
    list.forEach((raw, index) => {
      const entry = raw as Record<string, unknown>;
      const title = String(entry.title ?? '');
      const company = String(entry.company ?? '');
      if (title.length < 1 || title.length > 100) {
        fields[`experience.${index}.title`] = 'Enter a title of 1 to 100 characters.';
      }
      if (company.length < 1 || company.length > 100) {
        fields[`experience.${index}.company`] = 'Enter a company of 1 to 100 characters.';
      }
      if (!monthPattern(entry.start)) fields[`experience.${index}.start`] = 'Use YYYY-MM.';
      if (entry.end !== null && entry.end !== undefined && entry.end !== '') {
        if (!monthPattern(entry.end)) fields[`experience.${index}.end`] = 'Use YYYY-MM.';
        else if (String(entry.end) < String(entry.start)) {
          fields[`experience.${index}.end`] = 'End must be after start.';
        }
      }
    });
    if (Object.keys(fields).length > 0) throw validation(fields);
    await transact(async (client) => {
      await client.query('DELETE FROM experience WHERE member_id = $1', [memberId]);
      for (const [index, raw] of list.entries()) {
        const entry = raw as Record<string, unknown>;
        await client.query(
          `INSERT INTO experience (id, member_id, position, title, company, start_ym, end_ym)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            newId('exp'),
            memberId,
            index,
            String(entry.title),
            String(entry.company),
            String(entry.start),
            entry.end === null || entry.end === undefined || entry.end === '' ? null : String(entry.end),
          ],
        );
      }
    });
  } else if (section === 'education') {
    const list = Array.isArray(body.education) ? body.education : [];
    const fields: Record<string, string> = {};
    list.forEach((raw, index) => {
      const entry = raw as Record<string, unknown>;
      const school = String(entry.school ?? '');
      const degree = String(entry.degree ?? '');
      if (school.length < 1 || school.length > 100) {
        fields[`education.${index}.school`] = 'Enter a school of 1 to 100 characters.';
      }
      if (degree.length < 1 || degree.length > 100) {
        fields[`education.${index}.degree`] = 'Enter a degree of 1 to 100 characters.';
      }
      if (!monthPattern(entry.start)) fields[`education.${index}.start`] = 'Use YYYY-MM.';
      if (entry.end !== null && entry.end !== undefined && entry.end !== '') {
        if (!monthPattern(entry.end)) fields[`education.${index}.end`] = 'Use YYYY-MM.';
        else if (String(entry.end) < String(entry.start)) {
          fields[`education.${index}.end`] = 'End must be after start.';
        }
      }
    });
    if (Object.keys(fields).length > 0) throw validation(fields);
    await transact(async (client) => {
      await client.query('DELETE FROM education WHERE member_id = $1', [memberId]);
      for (const [index, raw] of list.entries()) {
        const entry = raw as Record<string, unknown>;
        await client.query(
          `INSERT INTO education (id, member_id, position, school, degree, start_ym, end_ym)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            newId('edu'),
            memberId,
            index,
            String(entry.school),
            String(entry.degree),
            String(entry.start),
            entry.end === null || entry.end === undefined || entry.end === '' ? null : String(entry.end),
          ],
        );
      }
    });
  } else {
    const names = Array.isArray(body.skills) ? body.skills.map((name) => String(name)) : [];
    const featured = Array.isArray(body.featured) ? body.featured.map((name) => String(name)) : [];
    if (names.length > config.maxSkills) {
      throw namedValidation('skill_limit', { limit: config.maxSkills });
    }
    if (featured.length > MAX_FEATURED_SKILLS) {
      throw namedValidation('featured_limit', { limit: MAX_FEATURED_SKILLS });
    }
    const fields: Record<string, string> = {};
    const seen = new Set<string>();
    names.forEach((name, index) => {
      if (name.length < 1 || name.length > 40) {
        fields[`skills.${index}`] = 'Enter a skill of 1 to 40 characters.';
      }
      if (seen.has(name.toLowerCase())) fields[`skills.${index}`] = 'Skills must differ.';
      seen.add(name.toLowerCase());
    });
    for (const [index, name] of featured.entries()) {
      if (!seen.has(name.toLowerCase())) fields[`featured.${index}`] = 'Feature a listed skill.';
    }
    if (Object.keys(fields).length > 0) throw validation(fields);

    await transact(async (client) => {
      const existing = await client.query<{ id: string; name: string }>(
        'SELECT id, name FROM skills WHERE member_id = $1',
        [memberId],
      );
      const keep = new Set(names.map((name) => name.toLowerCase()));
      for (const row of existing.rows) {
        if (!keep.has(row.name.toLowerCase())) {
          await client.query('DELETE FROM skills WHERE id = $1', [row.id]);
        }
      }
      for (const name of names) {
        const position = featured.findIndex((entry) => entry.toLowerCase() === name.toLowerCase());
        const featuredPosition = position === -1 ? null : position + 1;
        const found = existing.rows.find((row) => row.name.toLowerCase() === name.toLowerCase());
        if (found) {
          await client.query('UPDATE skills SET name = $2, featured_position = $3 WHERE id = $1', [
            found.id,
            name,
            featuredPosition,
          ]);
        } else {
          await client.query(
            'INSERT INTO skills (id, member_id, name, featured_position) VALUES ($1,$2,$3,$4)',
            [newId('skl'), memberId, name, featuredPosition],
          );
        }
      }
    });
  }

  const nextVersion = currentVersion + 1;
  await query(`UPDATE members SET versions = jsonb_set(versions, $2, $3::jsonb) WHERE id = $1`, [
    memberId,
    `{${section}}`,
    String(nextVersion),
  ]);
  const updated = await memberById(memberId);
  if (!updated) throw notFound();
  pushTo([memberId], 'profile', { member_id: memberId, section });
  if (section === 'skills') pushTo([memberId], 'skills', { member_id: memberId });
  return {
    status: 200,
    body: {
      section,
      version: nextVersion,
      current: await sectionCurrent(updated, section),
    },
  };
}

export async function patchSettings(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const memberId = requireMember(ctx);
  const body = jsonBody(ctx);
  const visibility = String(body.visibility ?? '');
  if (!['public', 'connections', 'private'].includes(visibility)) {
    throw validation({ visibility: 'Choose Public, Connections only or Private.' });
  }
  await query('UPDATE members SET visibility = $2 WHERE id = $1', [memberId, visibility]);
  return { status: 200, body: { visibility } };
}

export async function uploadPhoto(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const memberId = requireMember(ctx);
  const file = await readUpload(ctx.req, config.photoMaxBytes);
  if (file.bytes.length > config.photoMaxBytes) {
    throw namedValidation('photo_too_large', { limit: config.photoMaxBytes });
  }
  const type = detectPhotoType(file.bytes);
  if (!type) throw namedValidation('photo_type');
  const stripped = stripPhotoMetadata(file.bytes, type);
  const id = newId('pht');
  const key = `photos/${id}.${type === 'image/jpeg' ? 'jpg' : 'png'}`;
  try {
    await putObject(key, stripped, type);
    const size = await headObjectSize(key);
    if (size !== stripped.length) throw new StorageUnavailable();
  } catch {
    throw storageUnavailable();
  }
  await query(
    'INSERT INTO photo_uploads (id, member_id, content_type, bytes, created_at) VALUES ($1,$2,$3,$4,$5)',
    [id, memberId, type, stripped.length, businessNow()],
  );
  return {
    status: 201,
    body: { photo_id: id, url: `/media/photos/${id}`, bytes: stripped.length, content_type: type },
  };
}

export async function putMyPhoto(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const memberId = requireMember(ctx);
  const body = jsonBody(ctx);
  const photoId = String(body.photo_id ?? '');
  const rows = await query<{ id: string }>(
    'SELECT id FROM photo_uploads WHERE id = $1 AND member_id = $2',
    [photoId, memberId],
  );
  if (rows.length === 0) throw notFound();
  await query('UPDATE members SET photo_id = $2 WHERE id = $1', [memberId, photoId]);
  return { status: 200, body: { photo_url: `/media/photos/${photoId}` } };
}

export async function deleteMyPhoto(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const memberId = requireMember(ctx);
  await query('UPDATE members SET photo_id = NULL WHERE id = $1', [memberId]);
  return { status: 200, body: { photo_url: null } };
}

export async function uploadResume(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const memberId = requireMember(ctx);
  const file = await readUpload(ctx.req, config.resumeMaxBytes);
  if (!isPdf(file.bytes)) throw namedValidation('resume_type');
  if (file.bytes.length > config.resumeMaxBytes) {
    throw namedValidation('resume_too_large', { limit: config.resumeMaxBytes });
  }
  const id = newId('res');
  const key = `resumes/${memberId}/${id}.pdf`;
  try {
    await putObject(key, file.bytes, 'application/pdf');
    const size = await headObjectSize(key);
    if (size !== file.bytes.length) throw new StorageUnavailable();
  } catch {
    throw storageUnavailable();
  }
  const sha256 = createHash('sha256').update(file.bytes).digest('hex');
  await query(
    'INSERT INTO resume_uploads (id, member_id, bytes, sha256, created_at) VALUES ($1,$2,$3,$4,$5)',
    [id, memberId, file.bytes.length, sha256, businessNow()],
  );
  return { status: 201, body: { resume_id: id, bytes: file.bytes.length, sha256 } };
}

/** Photos follow the visibility of whatever shows them. */
export async function readPhoto(ctx: Ctx): Promise<void> {
  const viewerId = requireMember(ctx);
  const photoId = ctx.params.photo_id;
  const upload = await query<{ id: string; member_id: string; content_type: string }>(
    'SELECT id, member_id, content_type FROM photo_uploads WHERE id = $1',
    [photoId],
  );
  const photo = upload[0];
  if (!photo) throw notFound();

  let allowed = photo.member_id === viewerId;
  if (!allowed) {
    const owner = await query<{ id: string }>('SELECT id FROM members WHERE photo_id = $1', [photoId]);
    if (owner[0]) {
      const member = await memberById(owner[0].id);
      allowed = member !== null && (await profileProjection(viewerId, member)) !== null;
    }
    if (!allowed) {
      const post = await query<{ id: string; author_id: string; deleted_at: Date | null }>(
        'SELECT id, author_id, deleted_at FROM posts WHERE photo_id = $1',
        [photoId],
      );
      if (post[0] && !post[0].deleted_at) {
        const author = await memberById(post[0].author_id);
        allowed = author !== null && (await profileProjection(viewerId, author)) !== null;
      }
    }
  }
  if (!allowed) throw notFound();

  const key = `photos/${photoId}.${photo.content_type === 'image/jpeg' ? 'jpg' : 'png'}`;
  let bytes: Buffer;
  try {
    bytes = await getObject(key);
  } catch {
    throw storageUnavailable();
  }
  ctx.res.writeHead(200, {
    'content-type': photo.content_type,
    'content-length': String(bytes.length),
    'cache-control': 'private, max-age=60',
  });
  ctx.res.end(bytes);
}

/** Only 1st-degree connections may endorse a listed skill, once per skill. */
async function endorsementTarget(
  viewerId: string,
  memberId: string,
  skillName: string,
): Promise<{ owner: MemberRow; skillId: string }> {
  const owner = await memberById(memberId);
  if (!owner) throw notFound();
  if ((await profileProjection(viewerId, owner)) === null) throw notFound();
  const skills = await query<{ id: string }>(
    'SELECT id FROM skills WHERE member_id = $1 AND lower(name) = lower($2)',
    [memberId, skillName],
  );
  if (skills.length === 0) throw notFound();
  if (memberId === viewerId) throw forbidden('own_profile');
  if ((await degreeBetween(viewerId, memberId)) !== '1') throw forbidden('not_connected');
  return { owner, skillId: skills[0].id };
}

async function endorsementCount(skillId: string): Promise<number> {
  const rows = await query<{ count: string }>(
    'SELECT count(*) AS count FROM endorsements WHERE skill_id = $1',
    [skillId],
  );
  return Number(rows[0].count);
}

export async function addEndorsement(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const viewerId = requireMember(ctx);
  const skillName = decodeURIComponent(ctx.params.skill);
  const { owner, skillId } = await endorsementTarget(viewerId, ctx.params.member_id, skillName);
  await query(
    'INSERT INTO endorsements (skill_id, endorser_id, created_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
    [skillId, viewerId, businessNow()],
  );
  const stored = await query<{ name: string }>('SELECT name FROM skills WHERE id = $1', [skillId]);
  await notify({
    memberId: owner.id,
    actorId: viewerId,
    kind: 'endorsement',
    subjectId: skillId,
    targetUrl: `/in/${owner.handle}`,
    detail: stored[0].name,
  });
  pushTo([owner.id, viewerId], 'skills', { member_id: owner.id });
  return {
    status: 200,
    body: {
      skill: stored[0].name,
      endorsements: await endorsementCount(skillId),
      endorsed_by_me: true,
    },
  };
}

export async function removeEndorsement(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const viewerId = requireMember(ctx);
  const skillName = decodeURIComponent(ctx.params.skill);
  const { owner, skillId } = await endorsementTarget(viewerId, ctx.params.member_id, skillName);
  await query('DELETE FROM endorsements WHERE skill_id = $1 AND endorser_id = $2', [
    skillId,
    viewerId,
  ]);
  await removeNotificationActor(owner.id, 'endorsement', skillId, viewerId);
  const stored = await query<{ name: string }>('SELECT name FROM skills WHERE id = $1', [skillId]);
  pushTo([owner.id, viewerId], 'skills', { member_id: owner.id });
  return {
    status: 200,
    body: {
      skill: stored[0].name,
      endorsements: await endorsementCount(skillId),
      endorsed_by_me: false,
    },
  };
}
