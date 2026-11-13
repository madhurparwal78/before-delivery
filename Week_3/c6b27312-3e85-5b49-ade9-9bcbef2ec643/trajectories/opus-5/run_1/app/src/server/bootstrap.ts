import { query, transaction } from './db';
import {
  HERO_SLUG,
  HERO_SOURCE,
  SEED_EXTRA_REVISIONS,
  SEED_LIKES,
  SEED_PARTS,
  SEED_PASSWORD,
  SEED_USERS,
} from './seed';
import { createUser, findUserByEmail } from './auth';
import {
  commitRevision,
  createPart,
  evaluateForRevision,
  storeRevisionObjects,
  withEvents,
} from './parts';
import { headRevisionOf, loadPart, programOfSource } from './records';
import { ensureBucket } from './storage';
import { buildManifest } from '../tine/manifest';
import { validateValues } from './values';
import { sourceDefaults } from '../tine/manifest';

async function seedPart(options: {
  slug: string;
  title: string;
  category: string;
  ownerEmail: string;
  createdAt: Date;
  source: string;
  seedPosition: number | null;
  listed: boolean;
}): Promise<void> {
  if (await loadPart(options.slug)) return;
  const owner = await findUserByEmail(options.ownerEmail);
  if (!owner) return;
  const program = programOfSource(options.source);
  const values = sourceDefaults(program);
  const evaluated = evaluateForRevision(program, values);
  const sourceRef = await storeRevisionObjects(options.source, evaluated);
  const part = await withEvents(async (client) => {
    const created = await createPart(client, {
      slug: options.slug,
      title: options.title,
      category: options.category,
      visibility: 'public',
      ownerId: owner.id,
      createdAt: options.createdAt,
    });
    await client.query('update parts set seed_position = $1, listed = $2 where slug = $3', [
      options.seedPosition,
      options.listed,
      options.slug,
    ]);
    return created;
  });
  await commitRevision({
    part,
    authorId: owner.id,
    authorDisplayName: owner.display_name,
    values,
    message: 'First version',
    sourceRef,
    source: options.source,
    digest: evaluated.digest,
    volume: evaluated.volume,
    bbox: evaluated.bbox,
    faces: evaluated.faces,
    tape: evaluated.tape,
    evaluationId: evaluated.evaluationId,
    evaluated,
    createdAt: options.createdAt,
  });
}

/** The schema and seed data are applied idempotently every time the app serves. */
export async function seed(): Promise<void> {
  await ensureBucket();
  await transaction(async (client) => {
    await client.query('select pg_advisory_xact_lock(hashtext($1))', ['tinework-seed']);
  });

  for (const user of SEED_USERS) {
    if (!(await findUserByEmail(user.email))) {
      await createUser(user.email, SEED_PASSWORD, user.displayName, true, new Date('2026-09-01T00:00:00.000Z'));
    }
  }

  for (const part of SEED_PARTS) {
    await seedPart({
      slug: part.slug,
      title: part.title,
      category: part.category,
      ownerEmail: part.ownerEmail,
      createdAt: new Date(part.createdAt),
      source: part.source,
      seedPosition: part.position,
      listed: true,
    });
  }

  await seedPart({
    slug: HERO_SLUG,
    title: 'Hero cable clip',
    category: 'organisers',
    ownerEmail: SEED_USERS[0].email,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    source: HERO_SOURCE,
    seedPosition: null,
    listed: false,
  });

  for (const extra of SEED_EXTRA_REVISIONS) {
    const part = await loadPart(extra.slug);
    if (!part) continue;
    const head = await headRevisionOf(extra.slug);
    if (!head) continue;
    const existing = await query<{ count: string }>(
      'select count(*)::text as count from revisions where part_slug = $1',
      [extra.slug],
    );
    const already = Number(existing.rows[0].count);
    const wanted = SEED_EXTRA_REVISIONS.filter((entry) => entry.slug === extra.slug).length + 1;
    if (already >= wanted) continue;
    const author = await findUserByEmail(extra.authorEmail);
    if (!author) continue;
    const source = await (await import('./records')).sourceOfRef(head.source_ref);
    const program = programOfSource(source);
    const manifest = buildManifest(program, {});
    const values = validateValues(manifest, extra.values);
    const evaluated = evaluateForRevision(program, values);
    const sourceRef = await storeRevisionObjects(source, evaluated);
    await commitRevision({
      part,
      authorId: author.id,
      authorDisplayName: author.display_name,
      values,
      message: extra.message,
      sourceRef,
      source,
      digest: evaluated.digest,
      volume: evaluated.volume,
      bbox: evaluated.bbox,
      faces: evaluated.faces,
      tape: evaluated.tape,
      evaluationId: evaluated.evaluationId,
      evaluated,
      createdAt: new Date(part.created_at.getTime() + 86400000),
    });
  }

  for (const like of SEED_LIKES) {
    for (const email of like.emails) {
      const user = await findUserByEmail(email);
      if (!user) continue;
      await query(
        'insert into likes (part_slug, user_id, created_at) values ($1,$2,now()) on conflict do nothing',
        [like.slug, user.id],
      );
    }
  }
}
