import type { Ctx, Method } from './http';
import { requireSession } from './http';
import { query, withTransaction, type Tx } from './db';
import {
  commentRequired,
  forbidden,
  identifierDuplicate,
  identifierInvalid,
  identifierMissing,
  identifierPrefix,
  invalidBody,
  notFound,
  openVersion,
  publishBlocked,
  replacementMissing,
  staleVersion,
  wrongStateVersion,
} from './errors';
import type { Config } from './config';
import { readClock } from './clock';
import { appendAudit } from './audit';
import { notify } from './pglisten';
import { auditDenied } from './audit-denied';
import { created } from './created';
import { CHAPTER_SLUGS, VERSION_STATE_WORDS, type VersionState } from '../shared/domain';

const IDENTIFIER_RE = /^[a-z]+\.[a-z0-9-]+\.[a-z0-9-]+$/;

export function canSeeVersion(principal: { role: string }, state: VersionState): boolean {
  if (state === 'published' || state === 'superseded') return true;
  return ['author', 'brand_reviewer', 'owner'].includes(principal.role);
}

export function routeChapters(
  router: { add: (m: Method, p: string, h: (ctx: Ctx) => Promise<unknown>) => void },
  cfg: Config,
): void {
  router.add('GET', '/chapters', async () => {
    const chapters = await publishedChapters();
    const liveRules = await query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM rule_events WHERE event = 'live'`,
    );
    return { chapters, liveRuleCount: Number(liveRules[0]?.c ?? 0) };
  });

  router.add('GET', '/chapters/:slug', async (ctx) => {
    const slug = ctx.params.slug;
    const published = await query<{ number: number; published_at: Date }>(
      `SELECT number, published_at FROM chapter_versions WHERE chapter_slug = $1 AND state = 'published'`,
      [slug],
    );
    if (published.length === 0) throw notFound();
    const version = await query<{ intro: string; statements: { identifier: string; text: string }[]; asset_ids: string[] }>(
      `SELECT intro, statements, asset_ids FROM chapter_versions WHERE chapter_slug = $1 AND number = $2`,
      [slug, published[0].number],
    );
    const assets = await query<{ name: string }>(
      'SELECT a.name FROM assets a WHERE a.id = ANY($1::text[]) ORDER BY a.name',
      [version[0].asset_ids],
    );
    return {
      slug,
      title: chapterTitle(slug),
      version: published[0].number,
      publishedAt: published[0].published_at.toISOString(),
      intro: version[0].intro,
      statements: version[0].statements,
      assets: assets.map((a) => a.name),
    };
  });

  router.add('GET', '/rules', async () => {
    const rows = await query<{
      identifier: string;
      chapter_slug: string;
      version_number: number;
      statements: { identifier: string; text: string }[];
    }>(
      `SELECT e.identifier, e.chapter_slug, e.version_number, v.statements
         FROM rule_events e
         JOIN chapter_versions v ON v.chapter_slug = e.chapter_slug AND v.number = e.version_number AND v.state = 'published'
        WHERE e.event = 'live'`,
    );
    const rules = rows.map((row) => {
      const statement = row.statements.find((s) => s.identifier === row.identifier);
      return {
        identifier: row.identifier,
        chapter: chapterTitle(row.chapter_slug),
        text: statement?.text ?? '',
        version: row.version_number,
      };
    });
    rules.sort((a, b) => (a.identifier < b.identifier ? -1 : 1));
    return { rules };
  });

  router.add('GET', '/rules/:identifier', async (ctx) => {
    const identifier = ctx.params.identifier;
    const live = await query<{ chapter_slug: string; version_number: number }>(
      `SELECT chapter_slug, version_number FROM rule_events WHERE identifier = $1 AND event = 'live'`,
      [identifier],
    );
    if (live.length > 0) {
      const statement = await query<{ statements: { identifier: string; text: string }[] }>(
        `SELECT statements FROM chapter_versions WHERE chapter_slug = $1 AND number = $2`,
        [live[0].chapter_slug, live[0].version_number],
      );
      const found = statement[0]?.statements.find((s) => s.identifier === identifier) ?? null;
      return {
        identifier,
        status: 'live',
        chapter: chapterTitle(live[0].chapter_slug),
        chapterSlug: live[0].chapter_slug,
        text: found?.text ?? '',
      };
    }
    const withdrawn = await query<{ version_number: number; replaced_by: string }>(
      `SELECT version_number, replaced_by FROM rule_events WHERE identifier = $1 AND event = 'withdrawn' ORDER BY version_number DESC`,
      [identifier],
    );
    if (withdrawn.length === 0) throw notFound();
    return {
      identifier,
      status: 'withdrawn',
      withdrawnInVersion: withdrawn[0].version_number,
      replacedBy: withdrawn[0].replaced_by,
    };
  });

  router.add('GET', '/chapters/:slug/versions', async (ctx) => {
    const principal = requireSession(ctx);
    if (!['author', 'brand_reviewer', 'owner'].includes(principal.role)) throw notFound();
    const rows = await query<{ id: string; number: number; state: string; revision: number; published_at: Date | null }>(
      `SELECT id, number, state, revision, published_at FROM chapter_versions WHERE chapter_slug = $1 ORDER BY number`,
      [ctx.params.slug],
    );
    return {
      versions: rows.map((r) => ({
        id: r.id,
        number: r.number,
        state: r.state,
        stateWord: VERSION_STATE_WORDS[r.state as VersionState],
        revision: r.revision,
        publishedAt: r.published_at ? r.published_at.toISOString() : null,
      })),
    };
  });

  router.add('GET', '/versions/:id', async (ctx) => {
    const principal = ctx.principal;
    const rows = await query<{
      chapter_slug: string;
      number: number;
      state: string;
      revision: number;
      intro: string;
      statements: { identifier: string; text: string }[];
      asset_ids: string[];
      withdrawn: { identifier: string; replacedBy: string }[];
      published_at: Date | null;
    }>(
      `SELECT chapter_slug, number, state, revision, intro, statements, asset_ids, withdrawn, published_at
         FROM chapter_versions WHERE id = $1`,
      [ctx.params.id],
    );
    if (rows.length === 0) throw notFound();
    if (!canSeeVersion(principal ?? { role: 'anonymous' }, rows[0].state as VersionState)) throw notFound();
    const assets = await query<{ id: string; name: string; state: string }>(
      'SELECT id, name, state FROM assets WHERE id = ANY($1::text[]) ORDER BY name',
      [rows[0].asset_ids],
    );
    return {
      id: ctx.params.id,
      chapterSlug: rows[0].chapter_slug,
      number: rows[0].number,
      state: rows[0].state,
      stateWord: VERSION_STATE_WORDS[rows[0].state as VersionState],
      revision: rows[0].revision,
      intro: rows[0].intro,
      statements: rows[0].statements,
      assetIds: rows[0].asset_ids,
      assets: assets.map((a) => ({ id: a.id, name: a.name, state: a.state })),
      withdrawn: rows[0].withdrawn,
      publishedAt: rows[0].published_at ? rows[0].published_at.toISOString() : null,
    };
  });

  router.add('POST', '/chapters/:slug/versions', async (ctx) => {
    const principal = requireSession(ctx);
    if (principal.role !== 'author') {
      await auditDenied(
        {
          actorId: principal.id,
          actorRole: principal.role,
          action: 'chapter.submitted',
          resourceType: 'chapter_version',
          resourceId: ctx.params.id,
        },
        await readClock(cfg),
      );
      throw forbidden();
    }
    const slug = ctx.params.slug;
    const existing = await query<{ state: string; number: number }>(
      `SELECT state, number FROM chapter_versions WHERE chapter_slug = $1`,
      [slug],
    );
    const open = existing.find((v) => ['draft', 'in_review', 'approved'].includes(v.state));
    if (open) {
      const highest = Math.max(...existing.map((v) => v.number));
      throw openVersion(highest + 1);
    }
    const latest = existing.length > 0 ? existing.sort((a, b) => a.number - b.number)[existing.length - 1] : null;
    const nextNumber = (latest?.number ?? 0) + 1;
    const now = await readClock(cfg);
    const newVersionId = await withTransaction(async (tx) => {
      const id = `ver_${slug}_${nextNumber}`;
      const source = latest
        ? await txRows<{ intro: string; statements: unknown; asset_ids: string[]; withdrawn: unknown }>(
            tx,
            'SELECT intro, statements, asset_ids, withdrawn FROM chapter_versions WHERE chapter_slug = $1 AND number = $2',
            [slug, latest.number],
          )
        : [];
      await tx.query(
        `INSERT INTO chapter_versions (id, chapter_slug, number, state, author_id, revision, intro, statements, asset_ids, withdrawn, published_at, created_at, updated_at)
         VALUES ($1,$2,$3,'draft',$4,1,$5,$6,$7,$8,NULL,$9,$9)`,
        [
          id,
          slug,
          nextNumber,
          principal.id,
          source[0]?.intro ?? '',
          JSON.stringify(source[0]?.statements ?? []),
          source[0]?.asset_ids ?? [],
          JSON.stringify(source[0]?.withdrawn ?? []),
          now,
        ],
      );
      return id;
    });
    return created(await versionOut(newVersionId));
  });

  router.add('PUT', '/versions/:id', async (ctx) => {
    const principal = requireSession(ctx);
    if (principal.role !== 'author') {
      await auditDenied(
        {
          actorId: principal.id,
          actorRole: principal.role,
          action: 'chapter.submitted',
          resourceType: 'chapter_version',
          resourceId: ctx.params.id,
        },
        await readClock(cfg),
      );
      throw forbidden();
    }
    const body = asRecord(ctx.body.json);
    const revision = Number(body.revision);
    const intro = typeof body.intro === 'string' ? body.intro : '';
    const statements = Array.isArray(body.statements)
      ? body.statements.map((s) => {
          const rec = asRecord(s);
          return {
            identifier: typeof rec.identifier === 'string' ? rec.identifier : '',
            text: typeof rec.text === 'string' ? rec.text : '',
          };
        })
      : [];
    const assetIds = Array.isArray(body.assetIds)
      ? body.assetIds.filter((v): v is string => typeof v === 'string')
      : [];
    const withdrawn = Array.isArray(body.withdrawn)
      ? body.withdrawn.map((w) => {
          const rec = asRecord(w);
          return {
            identifier: typeof rec.identifier === 'string' ? rec.identifier : '',
            replacedBy: typeof rec.replacedBy === 'string' ? rec.replacedBy : '',
          };
        })
      : [];
    const version = await query<{ chapter_slug: string; number: number; state: string; revision: number }>(
      'SELECT chapter_slug, number, state, revision FROM chapter_versions WHERE id = $1',
      [ctx.params.id],
    );
    if (version.length === 0) throw notFound();
    if (version[0].state !== 'draft') {
      throw wrongStateVersion(version[0].number, VERSION_STATE_WORDS[version[0].state as VersionState]);
    }
    if (revision !== version[0].revision) throw staleVersion();
    validateIdentifiers(version[0].chapter_slug, statements, withdrawn);
    const now = await readClock(cfg);
    await withTransaction(async (tx) => {
      const res = await tx.query(
        `UPDATE chapter_versions SET intro = $2, statements = $3, asset_ids = $4, withdrawn = $5,
            revision = revision + 1, updated_at = $6
          WHERE id = $1 AND revision = $7 RETURNING revision`,
        [ctx.params.id, intro, JSON.stringify(statements), assetIds, JSON.stringify(withdrawn), now, revision],
      );
      if (res.rows.length === 0) throw staleVersion();
    });
    return versionOut(ctx.params.id);
  });

  router.add('POST', '/versions/:id/submit', async (ctx) => {
    const principal = requireSession(ctx);
    const version = await query<{ chapter_slug: string; number: number; state: string; statements: { identifier: string }[] }>(
      'SELECT chapter_slug, number, state, statements FROM chapter_versions WHERE id = $1',
      [ctx.params.id],
    );
    if (version.length === 0) throw notFound();
    if (!canSeeVersion(principal, version[0].state as VersionState)) throw notFound();
    if (principal.role !== 'author') {
      await auditDenied(
        {
          actorId: principal.id,
          actorRole: principal.role,
          action: 'chapter.submitted',
          resourceType: 'chapter_version',
          resourceId: ctx.params.id,
        },
        await readClock(cfg),
      );
      throw forbidden();
    }
    if (version[0].state !== 'draft') {
      throw wrongStateVersion(version[0].number, VERSION_STATE_WORDS[version[0].state as VersionState]);
    }
    if (version[0].statements.some((s) => !s.identifier)) throw identifierMissing();
    const now = await readClock(cfg);
    await withTransaction(async (tx) => {
      await tx.query(`UPDATE chapter_versions SET state = 'in_review', updated_at = $2 WHERE id = $1`, [
        ctx.params.id,
        now,
      ]);
      await appendAudit(tx, {
        occurredAt: now,
        actorId: principal.id,
        actorRole: principal.role,
        action: 'chapter.submitted',
        resourceType: 'chapter_version',
        resourceId: ctx.params.id,
        requestId: null,
        before: { state: 'draft' },
        after: { state: 'in_review' },
        outcome: 'success',
      });
      await notify(tx, JSON.stringify({ type: 'chapter.updated', slug: version[0].chapter_slug }));
    });
    return versionOut(ctx.params.id);
  });

  router.add('POST', '/versions/:id/approve', async (ctx) => {
    const principal = requireSession(ctx);
    const version = await query<{ chapter_slug: string; number: number; state: string }>(
      'SELECT chapter_slug, number, state FROM chapter_versions WHERE id = $1',
      [ctx.params.id],
    );
    if (version.length === 0) throw notFound();
    if (!canSeeVersion(principal, version[0].state as VersionState)) throw notFound();
    if (principal.role !== 'brand_reviewer') {
      await auditDenied(
        {
          actorId: principal.id,
          actorRole: principal.role,
          action: 'chapter.approved',
          resourceType: 'chapter_version',
          resourceId: ctx.params.id,
        },
        await readClock(cfg),
      );
      throw forbidden();
    }
    if (version[0].state !== 'in_review') {
      throw wrongStateVersion(version[0].number, VERSION_STATE_WORDS[version[0].state as VersionState]);
    }
    const now = await readClock(cfg);
    await withTransaction(async (tx) => {
      await tx.query(`UPDATE chapter_versions SET state = 'approved', updated_at = $2 WHERE id = $1`, [
        ctx.params.id,
        now,
      ]);
      await appendAudit(tx, {
        occurredAt: now,
        actorId: principal.id,
        actorRole: principal.role,
        action: 'chapter.approved',
        resourceType: 'chapter_version',
        resourceId: ctx.params.id,
        requestId: null,
        before: { state: 'in_review' },
        after: { state: 'approved' },
        outcome: 'success',
      });
    });
    return versionOut(ctx.params.id);
  });

  router.add('POST', '/versions/:id/request-changes', async (ctx) => {
    const principal = requireSession(ctx);
    const body = asRecord(ctx.body.json);
    const comment = typeof body.comment === 'string' ? body.comment : '';
    if (comment.trim().length === 0) throw commentRequired();
    const version = await query<{ chapter_slug: string; number: number; state: string }>(
      'SELECT chapter_slug, number, state FROM chapter_versions WHERE id = $1',
      [ctx.params.id],
    );
    if (version.length === 0) throw notFound();
    if (!canSeeVersion(principal, version[0].state as VersionState)) throw notFound();
    if (principal.role !== 'brand_reviewer') {
      await auditDenied(
        {
          actorId: principal.id,
          actorRole: principal.role,
          action: 'chapter.approved',
          resourceType: 'chapter_version',
          resourceId: ctx.params.id,
        },
        await readClock(cfg),
      );
      throw forbidden();
    }
    if (version[0].state !== 'in_review') {
      throw wrongStateVersion(version[0].number, VERSION_STATE_WORDS[version[0].state as VersionState]);
    }
    const now = await readClock(cfg);
    await withTransaction(async (tx) => {
      await tx.query(`UPDATE chapter_versions SET state = 'draft', updated_at = $2 WHERE id = $1`, [
        ctx.params.id,
        now,
      ]);
      await appendAudit(tx, {
        occurredAt: now,
        actorId: principal.id,
        actorRole: principal.role,
        action: 'chapter.changes_requested',
        resourceType: 'chapter_version',
        resourceId: ctx.params.id,
        requestId: null,
        before: { state: 'in_review' },
        after: { comment, state: 'draft' },
        outcome: 'success',
      });
    });
    return versionOut(ctx.params.id);
  });

  router.add('POST', '/versions/:id/publish', async (ctx) => {
    const principal = requireSession(ctx);
    const version = await query<{ chapter_slug: string; number: number; state: string; asset_ids: string[]; withdrawn: { identifier: string; replacedBy: string }[]; statements: { identifier: string; text: string }[] }>(
      'SELECT chapter_slug, number, state, asset_ids, withdrawn, statements FROM chapter_versions WHERE id = $1',
      [ctx.params.id],
    );
    if (version.length === 0) throw notFound();
    if (!canSeeVersion(principal, version[0].state as VersionState)) throw notFound();
    if (principal.role !== 'owner') {
      await auditDenied(
        {
          actorId: principal.id,
          actorRole: principal.role,
          action: 'chapter.published',
          resourceType: 'chapter_version',
          resourceId: ctx.params.id,
        },
        await readClock(cfg),
      );
      throw forbidden();
    }
    if (version[0].state !== 'approved') {
      throw wrongStateVersion(version[0].number, VERSION_STATE_WORDS[version[0].state as VersionState]);
    }
    await checkPublishable(version[0].chapter_slug, version[0].asset_ids, version[0].number);
    const now = await readClock(cfg);
    await withTransaction(async (tx) => {
      await publishVersion(tx, version[0].chapter_slug, version[0].number, version[0].asset_ids, version[0].withdrawn, version[0].statements, now, principal.id, principal.role, null);
    });
    return versionOut(ctx.params.id);
  });

  router.add('POST', '/chapters/:slug/republish', async (ctx) => {
    const principal = requireSession(ctx);
    if (principal.role !== 'owner') {
      await auditDenied(
        {
          actorId: principal.id,
          actorRole: principal.role,
          action: 'chapter.published',
          resourceType: 'chapter_version',
          resourceId: ctx.params.id,
        },
        await readClock(cfg),
      );
      throw forbidden();
    }
    const body = asRecord(ctx.body.json);
    const sourceNumber = Number(body.version);
    const source = await query<{
      id: string;
      number: number;
      state: string;
      intro: string;
      statements: { identifier: string; text: string }[];
      asset_ids: string[];
      withdrawn: { identifier: string; replacedBy: string }[];
    }>(
      `SELECT id, number, state, intro, statements, asset_ids, withdrawn FROM chapter_versions
        WHERE chapter_slug = $1 AND number = $2 AND state IN ('published','superseded')`,
      [ctx.params.slug, sourceNumber],
    );
    if (source.length === 0) throw notFound();
    const highestBefore = await query<{ max: number | null }>('SELECT MAX(number) AS max FROM chapter_versions WHERE chapter_slug = $1', [ctx.params.slug]);
    await checkPublishable(ctx.params.slug, source[0].asset_ids, (highestBefore[0]?.max ?? 0) + 1);
    const now = await readClock(cfg);
    const newVersionId = await withTransaction(async (tx) => {
      const highest = await txRows<{ max: number | null }>(
        tx,
        'SELECT MAX(number) AS max FROM chapter_versions WHERE chapter_slug = $1',
        [ctx.params.slug],
      );
      const nextNumber = (highest[0]?.max ?? 0) + 1;
      const id = `ver_${ctx.params.slug}_${nextNumber}`;
      await tx.query(
        `INSERT INTO chapter_versions (id, chapter_slug, number, state, author_id, revision, intro, statements, asset_ids, withdrawn, published_at, created_at, updated_at)
         VALUES ($1,$2,$3,'approved',$4,1,$5,$6,$7,$8,$9,$9,$9)`,
        [
          id,
          ctx.params.slug,
          nextNumber,
          principal.id,
          source[0].intro,
          JSON.stringify(source[0].statements),
          source[0].asset_ids,
          JSON.stringify(source[0].withdrawn),
          now,
        ],
      );
      await publishVersion(tx, ctx.params.slug, nextNumber, source[0].asset_ids, source[0].withdrawn, source[0].statements, now, principal.id, principal.role, sourceNumber);
      return id;
    });
    return created(await versionOut(newVersionId));
  });
}

async function checkPublishable(slug: string, assetIds: string[], number: number): Promise<void> {
  const assets = await query<{ id: string; name: string; state: string }>(
    'SELECT id, name, state FROM assets WHERE id = ANY($1::text[]) ORDER BY name',
    [assetIds],
  );
  const failures: string[] = [];
  for (const assetId of assetIds) {
    const asset = assets.find((a) => a.id === assetId);
    if (asset && asset.state !== 'released') {
      failures.push(`${asset.name} is ${asset.state}`);
    }
  }
  if (failures.length > 0) throw publishBlocked(number, failures);
  void slug;
}

async function publishVersion(
  tx: Tx,
  slug: string,
  number: number,
  assetIds: string[],
  withdrawn: { identifier: string; replacedBy: string }[],
  statements: { identifier: string; text: string }[],
  now: Date,
  actorId: string,
  actorRole: string,
  republishedFrom: number | null,
): Promise<void> {
  await tx.query(
    `UPDATE chapter_versions SET state = 'superseded' WHERE chapter_slug = $1 AND state = 'published'`,
    [slug],
  );
  await tx.query(
    `UPDATE chapter_versions SET state = 'published', published_at = $3, updated_at = $3 WHERE chapter_slug = $1 AND number = $2`,
    [slug, number, now],
  );
  await tx.query(`DELETE FROM rule_events WHERE chapter_slug = $1`, [slug]);
  for (const statement of statements) {
    if (statement.identifier) {
      await tx.query(
        `INSERT INTO rule_events (identifier, chapter_slug, version_number, event, occurred_at) VALUES ($1,$2,$3,'live',$4)`,
        [statement.identifier, slug, number, now],
      );
    }
  }
  for (const w of withdrawn) {
    await tx.query(`DELETE FROM rule_events WHERE identifier = $1 AND event = 'live'`, [w.identifier]);
    await tx.query(
      `INSERT INTO rule_events (identifier, chapter_slug, version_number, event, replaced_by, occurred_at)
       VALUES ($1,$2,$3,'withdrawn',$4,$5)`,
      [w.identifier, slug, number, w.replacedBy, now],
    );
  }
  await appendAudit(tx, {
    occurredAt: now,
    actorId,
    actorRole,
    action: 'chapter.published',
    resourceType: 'chapter_version',
    resourceId: `ver_${slug}_${number}`,
    requestId: null,
    before: republishedFrom === null ? { state: 'approved' } : null,
    after: republishedFrom === null ? { state: 'published', version: number } : { republishedFrom, state: 'published', version: number },
    outcome: 'success',
  });
  await notify(tx, JSON.stringify({ type: 'chapter.updated', slug }));
  void assetIds;
}

function validateIdentifiers(
  slug: string,
  statements: { identifier: string; text: string }[],
  withdrawn: { identifier: string; replacedBy: string }[],
): void {
  const seen = new Set<string>();
  for (const statement of statements) {
    if (!statement.identifier) continue;
    if (!IDENTIFIER_RE.test(statement.identifier)) throw identifierInvalid(statement.identifier);
    if (!statement.identifier.startsWith(`${slug}.`)) {
      throw identifierPrefix(statement.identifier, slug);
    }
    if (seen.has(statement.identifier)) throw identifierDuplicate(statement.identifier);
    seen.add(statement.identifier);
  }
  for (const w of withdrawn) {
    if (!statements.some((s) => s.identifier === w.identifier)) {
      const replacement = statements.find((s) => s.identifier === w.replacedBy);
      if (!replacement) throw replacementMissing(w.identifier);
    }
  }
}

async function publishedChapters(): Promise<{ slug: string; title: string; version: number; publishedAt: string; ruleCount: number }[]> {
  const out: { slug: string; title: string; version: number; publishedAt: string; ruleCount: number }[] = [];
  for (const slug of CHAPTER_SLUGS) {
    const rows = await query<{ number: number; published_at: Date; statements: { identifier: string }[] }>(
      `SELECT number, published_at, statements FROM chapter_versions WHERE chapter_slug = $1 AND state = 'published'`,
      [slug],
    );
    if (rows.length === 0) continue;
    out.push({
      slug,
      title: chapterTitle(slug),
      version: rows[0].number,
      publishedAt: rows[0].published_at.toISOString(),
      ruleCount: rows[0].statements.filter((s) => s.identifier).length,
    });
  }
  return out;
}

export function chapterTitle(slug: string): string {
  const titles: Record<string, string> = {
    logo: 'Logo',
    colour: 'Colour',
    typography: 'Typography',
    iconography: 'Iconography',
    motion: 'Motion',
    voice: 'Voice',
  };
  return titles[slug] ?? slug;
}

async function versionOut(id: string): Promise<unknown> {
  const rows = await query<{
    chapter_slug: string;
    number: number;
    state: string;
    revision: number;
    intro: string;
    statements: { identifier: string; text: string }[];
    asset_ids: string[];
    withdrawn: { identifier: string; replacedBy: string }[];
    published_at: Date | null;
  }>(
    `SELECT chapter_slug, number, state, revision, intro, statements, asset_ids, withdrawn, published_at
       FROM chapter_versions WHERE id = $1`,
    [id],
  );
  if (rows.length === 0) throw notFound();
  const assets = await query<{ id: string; name: string; state: string }>(
    'SELECT id, name, state FROM assets WHERE id = ANY($1::text[]) ORDER BY name',
    [rows[0].asset_ids],
  );
  return {
    id,
    chapterSlug: rows[0].chapter_slug,
    number: rows[0].number,
    state: rows[0].state,
    stateWord: VERSION_STATE_WORDS[rows[0].state as VersionState],
    revision: rows[0].revision,
    intro: rows[0].intro,
    statements: rows[0].statements,
    assetIds: rows[0].asset_ids,
    assets: assets.map((a) => ({ id: a.id, name: a.name, state: a.state })),
    withdrawn: rows[0].withdrawn,
    publishedAt: rows[0].published_at ? rows[0].published_at.toISOString() : null,
  };
}

async function txRows<T extends Record<string, unknown>>(tx: Tx, sql: string, params: readonly unknown[]): Promise<T[]> {
  const res = await tx.query(sql, params as unknown[]);
  return res.rows as T[];
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export { invalidBody };

