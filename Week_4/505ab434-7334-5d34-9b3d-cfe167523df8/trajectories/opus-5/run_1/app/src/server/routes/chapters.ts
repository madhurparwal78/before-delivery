import type { Statement, VersionState } from '../../shared/types.js';
import { appendAudit } from '../audit.js';
import { withTransaction, type Queryable } from '../db.js';
import type { PrincipalRecord, VersionRecord, WithdrawnEntry } from '../domain/records.js';
import { OPEN_VERSION_STATES, versionTransitions, wrongVersionState } from '../domain/transitions.js';
import { errors } from '../errors.js';
import { jsonBody, requireSignedIn, type Ctx } from '../http/context.js';
import { sendJson } from '../http/respond.js';
import { EVERYONE, publish } from '../live.js';
import { repo } from '../repo.js';
import { liveRules, resolveRule } from '../services/rules.js';

const IDENTIFIER_PATTERN = /^[a-z]+\.[a-z0-9-]+\.[a-z0-9-]+$/;

function canSeeOpenVersions(principal: PrincipalRecord | null): boolean {
  return (
    principal !== null &&
    (principal.role === 'author' || principal.role === 'brand_reviewer' || principal.role === 'owner')
  );
}

interface SelectableAsset {
  id: string;
  name: string;
  state: string;
}

function projectVersion(version: VersionRecord, assets: SelectableAsset[] = []): Record<string, unknown> {
  return {
    assets,
    id: version.id,
    slug: version.slug,
    number: version.number,
    state: version.state,
    revision: version.revision,
    publishedAt: version.publishedAt ? version.publishedAt.toISOString() : null,
    intro: version.intro,
    statements: version.statements,
    assetIds: version.assetIds,
    withdrawn: version.withdrawn,
    reviewComment: version.reviewComment,
  };
}

export async function listChapters(ctx: Ctx): Promise<void> {
  const chapters = await repo.chapters();
  const rules = await liveRules();
  const summaries = [];
  for (const chapter of chapters) {
    const published = await repo.publishedVersion(chapter.slug);
    if (!published) continue;
    summaries.push({
      slug: chapter.slug,
      title: chapter.title,
      version: published.number,
      publishedAt: published.publishedAt ? published.publishedAt.toISOString() : null,
      ruleCount: published.statements.length,
    });
  }
  sendJson(ctx.res, 200, { chapters: summaries, liveRuleCount: rules.length });
}

export async function readChapter(ctx: Ctx): Promise<void> {
  const slug = ctx.params['slug'] ?? '';
  const chapters = await repo.chapters();
  const chapter = chapters.find((candidate) => candidate.slug === slug);
  if (!chapter) throw errors.notFound();
  const published = await repo.publishedVersion(slug);
  if (!published) throw errors.notFound();
  const assets = await repo.assets();
  sendJson(ctx.res, 200, {
    slug: chapter.slug,
    title: chapter.title,
    version: published.number,
    publishedAt: published.publishedAt ? published.publishedAt.toISOString() : null,
    intro: published.intro,
    statements: published.statements,
    assets: published.assetIds.map(
      (assetId) => assets.find((asset) => asset.id === assetId)?.name ?? assetId,
    ),
  });
}

export async function listRules(ctx: Ctx): Promise<void> {
  sendJson(ctx.res, 200, { rules: await liveRules() });
}

export async function readRule(ctx: Ctx): Promise<void> {
  const rule = await resolveRule(ctx.params['identifier'] ?? '');
  if (!rule) throw errors.notFound();
  sendJson(ctx.res, 200, rule);
}

export async function listVersions(ctx: Ctx): Promise<void> {
  const principal = requireSignedIn(ctx);
  if (!canSeeOpenVersions(principal)) throw errors.notFound();
  const versions = await repo.versionsOfChapter(ctx.params['slug'] ?? '');
  if (versions.length === 0) throw errors.notFound();
  sendJson(ctx.res, 200, {
    versions: versions.map((version) => ({
      id: version.id,
      number: version.number,
      state: version.state,
      revision: version.revision,
      publishedAt: version.publishedAt ? version.publishedAt.toISOString() : null,
    })),
  });
}

async function loadVisibleVersion(ctx: Ctx): Promise<VersionRecord> {
  const version = await repo.version(ctx.params['id'] ?? '');
  if (!version) throw errors.notFound();
  const open = OPEN_VERSION_STATES.includes(version.state);
  if (open && !canSeeOpenVersions(ctx.principal)) throw errors.notFound();
  return version;
}

/** Version editors also receive the asset catalogue they may reference. */
async function selectableAssets(ctx: Ctx): Promise<SelectableAsset[]> {
  if (!canSeeOpenVersions(ctx.principal)) return [];
  const assets = await repo.assets();
  return assets.map((asset) => ({ id: asset.id, name: asset.name, state: asset.state }));
}

export async function readVersion(ctx: Ctx): Promise<void> {
  const version = await loadVisibleVersion(ctx);
  sendJson(ctx.res, 200, projectVersion(version, await selectableAssets(ctx)));
}

async function auditVersionDenial(
  ctx: Ctx,
  principal: PrincipalRecord,
  action: string,
  resourceId: string,
): Promise<never> {
  await withTransaction(async (tx) => {
    await appendAudit(tx, {
      occurredAt: ctx.now,
      actorId: principal.id,
      actorRole: principal.role,
      action,
      resourceType: 'chapter_version',
      resourceId,
      requestId: null,
      before: null,
      after: null,
      outcome: 'denied',
    });
  });
  throw errors.forbidden();
}

export async function startVersion(ctx: Ctx): Promise<void> {
  const principal = requireSignedIn(ctx);
  const slug = ctx.params['slug'] ?? '';
  const versions = await repo.versionsOfChapter(slug);
  if (versions.length === 0) throw errors.notFound();
  if (!canSeeOpenVersions(principal)) throw errors.notFound();
  if (principal.role !== 'author') await auditVersionDenial(ctx, principal, 'chapter.submitted', slug);

  const open = versions.find((version) => OPEN_VERSION_STATES.includes(version.state));
  if (open) throw errors.openVersion(open.number);

  const latest = versions[versions.length - 1]!;
  const number = latest.number + 1;
  const id = `ver_${slug}_${number}`;

  const created = await withTransaction(async (tx) => {
    await tx.query(
      `insert into chapter_versions (id, slug, number, state, author_id, intro, statements, asset_ids, withdrawn, revision)
       values ($1,$2,$3,'draft',$4,$5,$6::jsonb,$7,'[]'::jsonb,1)`,
      [id, slug, number, principal.id, latest.intro, JSON.stringify(latest.statements), latest.assetIds],
    );
    return (await repo.version(id, tx))!;
  });

  sendJson(ctx.res, 201, projectVersion(created));
}

interface SaveBody {
  revision?: number;
  intro?: string;
  statements?: Statement[];
  assetIds?: string[];
  withdrawn?: WithdrawnEntry[];
}

export async function saveVersion(ctx: Ctx): Promise<void> {
  const principal = requireSignedIn(ctx);
  const version = await loadVisibleVersion(ctx);
  if (principal.role !== 'author') await auditVersionDenial(ctx, principal, 'chapter.submitted', version.id);
  if (!versionTransitions.canEdit(version.state)) wrongVersionState(version.number, version.state);

  const body = jsonBody<SaveBody>(ctx);
  if (typeof body.revision === 'number' && body.revision !== version.revision) throw errors.staleVersion();

  const statements = Array.isArray(body.statements) ? body.statements : version.statements;
  const withdrawn = Array.isArray(body.withdrawn) ? body.withdrawn : version.withdrawn;
  validateIdentifiers(version.slug, statements, { allowBlank: true });
  await validateWithdrawals(version.slug, statements, withdrawn);

  const updated = await withTransaction(async (tx) => {
    await tx.query(
      `update chapter_versions set intro = $1, statements = $2::jsonb, asset_ids = $3, withdrawn = $4::jsonb,
         revision = revision + 1 where id = $5`,
      [
        typeof body.intro === 'string' ? body.intro : version.intro,
        JSON.stringify(statements),
        Array.isArray(body.assetIds) ? body.assetIds : version.assetIds,
        JSON.stringify(withdrawn),
        version.id,
      ],
    );
    return (await repo.version(version.id, tx))!;
  });

  sendJson(ctx.res, 200, projectVersion(updated));
}

function validateIdentifiers(slug: string, statements: Statement[], options: { allowBlank: boolean }): void {
  const seen = new Set<string>();
  for (const statement of statements) {
    const identifier = (statement.identifier ?? '').trim();
    if (identifier === '') {
      if (options.allowBlank) continue;
      throw errors.identifierMissing();
    }
    if (!IDENTIFIER_PATTERN.test(identifier)) throw errors.identifierInvalid(identifier);
    if (!identifier.startsWith(`${slug}.`)) throw errors.identifierPrefix(identifier, slug);
    if (seen.has(identifier)) throw errors.identifierDuplicate(identifier);
    seen.add(identifier);
  }
}

async function validateWithdrawals(
  slug: string,
  statements: Statement[],
  withdrawn: WithdrawnEntry[],
): Promise<void> {
  const published = await repo.publishedVersion(slug);
  if (!published) return;
  const present = new Set(statements.map((statement) => statement.identifier));
  for (const statement of published.statements) {
    if (present.has(statement.identifier)) continue;
    const entry = withdrawn.find((candidate) => candidate.identifier === statement.identifier);
    if (!entry || !present.has(entry.replacedBy)) throw errors.replacementMissing(statement.identifier);
  }
}

async function moveVersion(
  tx: Queryable,
  version: VersionRecord,
  state: VersionState,
  comment: string | null,
): Promise<void> {
  await tx.query('update chapter_versions set state = $1, review_comment = $2 where id = $3', [
    state,
    comment,
    version.id,
  ]);
}

export async function submitVersion(ctx: Ctx): Promise<void> {
  const principal = requireSignedIn(ctx);
  const version = await loadVisibleVersion(ctx);
  if (principal.role !== 'author') await auditVersionDenial(ctx, principal, 'chapter.submitted', version.id);
  if (!versionTransitions.canSubmit(version.state)) wrongVersionState(version.number, version.state);
  validateIdentifiers(version.slug, version.statements, { allowBlank: false });

  const updated = await withTransaction(async (tx) => {
    await moveVersion(tx, version, 'in_review', null);
    await appendAudit(tx, {
      occurredAt: ctx.now,
      actorId: principal.id,
      actorRole: principal.role,
      action: 'chapter.submitted',
      resourceType: 'chapter_version',
      resourceId: version.id,
      requestId: null,
      before: { state: 'draft' },
      after: { state: 'in_review' },
      outcome: 'success',
    });
    return (await repo.version(version.id, tx))!;
  });
  sendJson(ctx.res, 200, projectVersion(updated));
}

export async function approveVersion(ctx: Ctx): Promise<void> {
  const principal = requireSignedIn(ctx);
  const version = await loadVisibleVersion(ctx);
  if (principal.role !== 'brand_reviewer') await auditVersionDenial(ctx, principal, 'chapter.approved', version.id);
  if (!versionTransitions.canApprove(version.state)) wrongVersionState(version.number, version.state);

  const updated = await withTransaction(async (tx) => {
    await moveVersion(tx, version, 'approved', null);
    await appendAudit(tx, {
      occurredAt: ctx.now,
      actorId: principal.id,
      actorRole: principal.role,
      action: 'chapter.approved',
      resourceType: 'chapter_version',
      resourceId: version.id,
      requestId: null,
      before: { state: 'in_review' },
      after: { state: 'approved' },
      outcome: 'success',
    });
    return (await repo.version(version.id, tx))!;
  });
  sendJson(ctx.res, 200, projectVersion(updated));
}

export async function requestVersionChanges(ctx: Ctx): Promise<void> {
  const principal = requireSignedIn(ctx);
  const version = await loadVisibleVersion(ctx);
  if (principal.role !== 'brand_reviewer') {
    await auditVersionDenial(ctx, principal, 'chapter.changes_requested', version.id);
  }
  if (!versionTransitions.canRequestChanges(version.state)) wrongVersionState(version.number, version.state);

  const body = jsonBody<{ comment?: string }>(ctx);
  const comment = (body.comment ?? '').trim();
  if (comment === '') throw errors.commentRequired();

  const updated = await withTransaction(async (tx) => {
    await moveVersion(tx, version, 'draft', comment);
    await appendAudit(tx, {
      occurredAt: ctx.now,
      actorId: principal.id,
      actorRole: principal.role,
      action: 'chapter.changes_requested',
      resourceType: 'chapter_version',
      resourceId: version.id,
      requestId: null,
      before: { state: 'in_review' },
      after: { comment, state: 'draft' },
      outcome: 'success',
    });
    return (await repo.version(version.id, tx))!;
  });
  sendJson(ctx.res, 200, projectVersion(updated));
}

async function assertAssetsReleased(version: VersionRecord, source?: Queryable): Promise<void> {
  const assets = await repo.assets(source);
  const blockers: string[] = [];
  for (const assetId of version.assetIds) {
    const asset = assets.find((candidate) => candidate.id === assetId);
    if (asset && asset.state !== 'released') blockers.push(`${asset.name} is ${asset.state}`);
  }
  if (blockers.length > 0) throw errors.publishBlocked(version.number, blockers.join(', '));
}

export async function publishVersion(ctx: Ctx): Promise<void> {
  const principal = requireSignedIn(ctx);
  const version = await loadVisibleVersion(ctx);
  if (principal.role !== 'owner') await auditVersionDenial(ctx, principal, 'chapter.published', version.id);
  if (!versionTransitions.canPublish(version.state)) wrongVersionState(version.number, version.state);
  await assertAssetsReleased(version);

  const updated = await withTransaction(async (tx) => {
    await tx.query(
      `update chapter_versions set state = 'superseded' where slug = $1 and state = 'published'`,
      [version.slug],
    );
    await tx.query(`update chapter_versions set state = 'published', published_at = $1 where id = $2`, [
      ctx.now,
      version.id,
    ]);
    await appendAudit(tx, {
      occurredAt: ctx.now,
      actorId: principal.id,
      actorRole: principal.role,
      action: 'chapter.published',
      resourceType: 'chapter_version',
      resourceId: version.id,
      requestId: null,
      before: { state: 'approved' },
      after: { state: 'published', version: version.number },
      outcome: 'success',
    });
    await publish(tx, { type: 'chapter.updated', slug: version.slug }, EVERYONE);
    return (await repo.version(version.id, tx))!;
  });

  sendJson(ctx.res, 200, projectVersion(updated));
}

export async function republishVersion(ctx: Ctx): Promise<void> {
  const principal = requireSignedIn(ctx);
  const slug = ctx.params['slug'] ?? '';
  const versions = await repo.versionsOfChapter(slug);
  if (versions.length === 0) throw errors.notFound();
  if (principal.role !== 'owner') {
    if (!canSeeOpenVersions(principal)) throw errors.notFound();
    await auditVersionDenial(ctx, principal, 'chapter.published', slug);
  }

  const body = jsonBody<{ version?: number }>(ctx);
  const source = versions.find((candidate) => candidate.number === body.version);
  if (!source) throw errors.notFound();

  const latest = versions[versions.length - 1]!;
  const number = latest.number + 1;
  const id = `ver_${slug}_${number}`;
  await assertAssetsReleased({ ...source, number });

  const created = await withTransaction(async (tx) => {
    await tx.query(
      `update chapter_versions set state = 'superseded' where slug = $1 and state = 'published'`,
      [slug],
    );
    await tx.query(
      `insert into chapter_versions (id, slug, number, state, author_id, published_at, intro, statements,
         asset_ids, withdrawn, revision)
       values ($1,$2,$3,'published',$4,$5,$6,$7::jsonb,$8,$9::jsonb,1)`,
      [
        id,
        slug,
        number,
        principal.id,
        ctx.now,
        source.intro,
        JSON.stringify(source.statements),
        source.assetIds,
        JSON.stringify(source.withdrawn),
      ],
    );
    await appendAudit(tx, {
      occurredAt: ctx.now,
      actorId: principal.id,
      actorRole: principal.role,
      action: 'chapter.published',
      resourceType: 'chapter_version',
      resourceId: id,
      requestId: null,
      before: null,
      after: { republishedFrom: source.number, state: 'published', version: number },
      outcome: 'success',
    });
    await publish(tx, { type: 'chapter.updated', slug }, EVERYONE);
    return (await repo.version(id, tx))!;
  });

  sendJson(ctx.res, 201, projectVersion(created));
}
