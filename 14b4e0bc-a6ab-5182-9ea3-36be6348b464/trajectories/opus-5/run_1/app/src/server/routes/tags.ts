import { randomUUID } from 'node:crypto';
import { type Tag, codePointLength, isTag, sortIds, sortTags } from '../../shared/domain.ts';
import { serverTime } from '../../shared/businessTime.ts';
import { appendAudit, recheckAuthority, reserveSeq } from '../commit.ts';
import { type Queryable, withCommitOrder } from '../db.ts';
import type { Json } from '../domain/audit.ts';
import { type Snapshot, loadCurrentSnapshot } from '../domain/snapshot.ts';
import { changedColumns, hasEffectiveTag, stillReaching } from '../domain/tags.ts';
import { columnBody } from '../domain/views.ts';
import { claimIdempotency, fingerprintOf, requireValidKey } from '../idempotency.ts';
import type { Ctx, Reply } from '../http/context.ts';
import { errors } from '../http/errors.ts';
import type { Router } from '../http/router.ts';
import { graphWrite } from './graphWrite.ts';

function requireTag(value: unknown): Tag {
  if (!isTag(value)) throw errors.validation({ tag: 'Tag must be PII or Confidential.' });
  return value;
}

function requireColumn(client: Queryable, columnId: string): Promise<void> {
  return client
    .query('SELECT 1 FROM asset_columns WHERE id = $1', [columnId])
    .then((result) => {
      if ((result.rowCount ?? 0) === 0) throw errors.notFound();
    });
}

async function addDirectTag(client: Queryable, columnId: string, tag: Tag, seq: number): Promise<void> {
  await client.query('INSERT INTO column_tags (column_id, tag, added_seq) VALUES ($1,$2,$3)', [
    columnId,
    tag,
    seq,
  ]);
}

async function removeDirectTag(client: Queryable, columnId: string, tag: Tag, seq: number): Promise<void> {
  await client.query(
    'UPDATE column_tags SET removed_seq = $3 WHERE column_id = $1 AND tag = $2 AND removed_seq IS NULL',
    [columnId, tag, seq],
  );
}

function directTagsOf(snapshot: Snapshot, columnId: string): Tag[] {
  return [...(snapshot.columns.get(columnId)?.directTags ?? [])];
}

function suppressedTagsOf(snapshot: Snapshot, columnId: string): Tag[] {
  return [...(snapshot.columns.get(columnId)?.suppressedTags ?? [])];
}

export function registerTagRoutes(router: Router): void {
  router.add('POST', '/api/columns/:id/tags', async (ctx: Ctx): Promise<Reply> => {
    const columnId = ctx.params.id;
    const rawTag = ctx.json().tag;
    return graphWrite(
      ctx,
      'tag.write',
      (client) => requireColumn(client, columnId),
      async ({ client, actor, before, seq }) => {
        const tag = requireTag(rawTag);
        const column = before.columns.get(columnId);
        if (!column) throw errors.notFound();
        if (column.directTags.includes(tag)) {
          throw errors.conflict('tag_exists', `${columnId} already carries ${tag} directly.`);
        }
        if (column.suppressedTags.includes(tag)) {
          throw errors.conflict(
            'tag_suppressed',
            `${tag} is suppressed on ${columnId}; lift the suppression first.`,
          );
        }
        await addDirectTag(client, columnId, tag, seq);
        return {
          action: 'tag.add',
          targetType: 'column',
          targetId: columnId,
          auditBefore: { direct_tags: directTagsOf(before, columnId) },
          auditAfter: (after) => ({ direct_tags: directTagsOf(after, columnId) }),
          status: 201,
          body: (after) => ({
            column: columnBody(after, after.columns.get(columnId)!, actor.role),
            changed_columns: changedColumns(before, after),
          }),
        };
      },
    );
  });

  router.add('DELETE', '/api/columns/:id/tags/:tag', async (ctx: Ctx): Promise<Reply> => {
    const columnId = ctx.params.id;
    const rawTag = ctx.params.tag;
    return graphWrite(
      ctx,
      'tag.write',
      (client) => requireColumn(client, columnId),
      async ({ client, actor, before, seq }) => {
        const tag = requireTag(rawTag);
        const column = before.columns.get(columnId);
        if (!column) throw errors.notFound();
        if (!column.directTags.includes(tag)) {
          if (hasEffectiveTag(before, columnId, tag)) {
            throw errors.conflict(
              'tag_inherited',
              `${tag} on ${columnId} is inherited; withdraw it at its source.`,
            );
          }
          throw errors.conflict('tag_absent', `${columnId} does not carry ${tag}.`);
        }
        await removeDirectTag(client, columnId, tag, seq);
        return {
          action: 'tag.withdraw',
          targetType: 'column',
          targetId: columnId,
          auditBefore: { direct_tags: directTagsOf(before, columnId) },
          auditAfter: (after) => ({ direct_tags: directTagsOf(after, columnId) }),
          status: 200,
          body: (after) => ({
            column: columnBody(after, after.columns.get(columnId)!, actor.role),
            changed_columns: changedColumns(before, after),
            still_reaching: stillReaching(before, after, columnId, tag),
          }),
        };
      },
    );
  });

  router.add('POST', '/api/columns/:id/suppressions', async (ctx: Ctx): Promise<Reply> => {
    const columnId = ctx.params.id;
    const body = ctx.json();
    const rawTag = body.tag;
    const rawJustification = typeof body.justification === 'string' ? body.justification : '';
    return graphWrite(
      ctx,
      'tag.write',
      (client) => requireColumn(client, columnId),
      async ({ client, actor, before, seq }) => {
        const tag = requireTag(rawTag);
        const column = before.columns.get(columnId);
        if (!column) throw errors.notFound();
        if (column.suppressedTags.includes(tag)) {
          throw errors.conflict('suppression_exists', `${tag} is already suppressed on ${columnId}.`);
        }
        if (column.directTags.includes(tag)) {
          throw errors.conflict(
            'tag_not_inherited',
            `${tag} on ${columnId} is not inherited; withdraw it instead.`,
          );
        }
        if (!hasEffectiveTag(before, columnId, tag)) {
          throw errors.conflict('tag_absent', `${columnId} does not carry ${tag}.`);
        }
        const justification = rawJustification.trim();
        const length = codePointLength(justification);
        if (length < 10 || length > 500) {
          throw errors.validation({ justification: 'Give a justification of 10 to 500 characters.' });
        }
        await client.query(
          `INSERT INTO suppressions (column_id, tag, justification, actor_id, at, created_seq)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [columnId, tag, justification, actor.userId, serverTime(), seq],
        );
        return {
          action: 'tag.suppress',
          targetType: 'column',
          targetId: columnId,
          auditBefore: { suppressed_tags: suppressedTagsOf(before, columnId) },
          auditAfter: (after) => ({
            suppressed_tags: suppressedTagsOf(after, columnId),
            justification,
          }),
          status: 201,
          body: (after) => ({
            column: columnBody(after, after.columns.get(columnId)!, actor.role),
            changed_columns: changedColumns(before, after),
          }),
        };
      },
    );
  });

  router.add('DELETE', '/api/columns/:id/suppressions/:tag', async (ctx: Ctx): Promise<Reply> => {
    const columnId = ctx.params.id;
    const rawTag = ctx.params.tag;
    return graphWrite(
      ctx,
      'tag.write',
      async (client) => {
        await requireColumn(client, columnId);
        const recorded = await client.query(
          'SELECT 1 FROM suppressions WHERE column_id = $1 AND tag = $2 AND lifted_seq IS NULL',
          [columnId, rawTag],
        );
        if ((recorded.rowCount ?? 0) === 0) throw errors.notFound();
      },
      async ({ client, actor, before, seq }) => {
        const tag = rawTag as Tag;
        await client.query(
          'UPDATE suppressions SET lifted_seq = $3 WHERE column_id = $1 AND tag = $2 AND lifted_seq IS NULL',
          [columnId, tag, seq],
        );
        return {
          action: 'tag.unsuppress',
          targetType: 'column',
          targetId: columnId,
          auditBefore: { suppressed_tags: suppressedTagsOf(before, columnId) },
          auditAfter: (after) => ({ suppressed_tags: suppressedTagsOf(after, columnId) }),
          status: 200,
          body: (after) => ({
            column: columnBody(after, after.columns.get(columnId)!, actor.role),
            changed_columns: changedColumns(before, after),
          }),
        };
      },
    );
  });

  router.add('POST', '/api/assets/:id/tags/bulk', async (ctx: Ctx): Promise<Reply> => {
    const actor = await ctx.requireActor();
    const assetId = ctx.params.id;
    const body = ctx.json();
    const key = ctx.header('idempotency-key') ?? null;
    requireValidKey(key);
    const rawTag = body.tag;
    const columnIds = (Array.isArray(body.columns) ? body.columns : []).map((entry) =>
      typeof entry === 'string' ? entry : '',
    );
    const claim = await claimIdempotency({
      actorId: actor.userId,
      route: 'tags.bulk',
      assetId,
      key,
      fingerprint: fingerprintOf([String(rawTag), ...columnIds]),
    });
    if ('replay' in claim) return { status: claim.replay.status, json: claim.replay.body };

    try {
      const reply = await withCommitOrder(async (client) => {
        const assetRow = await client.query('SELECT 1 FROM assets WHERE id = $1', [assetId]);
        if ((assetRow.rowCount ?? 0) === 0) throw errors.notFound();
        const current = await recheckAuthority(client, actor, 'tag.write');
        if ('conflict' in claim) throw errors.idempotencyConflict();
        const tag = requireTag(rawTag);
        const before = await loadCurrentSnapshot(client);
        const fields: Record<string, string> = {};
        if (columnIds.length === 0 || columnIds.length > 200 || new Set(columnIds).size !== columnIds.length) {
          fields.columns = 'Select 1 to 200 columns of this asset.';
        }
        columnIds.forEach((columnId, index) => {
          const column = before.columns.get(columnId);
          if (!column || column.assetId !== assetId) {
            fields[`columns[${index}]`] = 'Unknown column of this asset.';
          }
        });
        if (Object.keys(fields).length > 0) throw errors.validation(fields);

        const seq = await reserveSeq(client);
        const results: {
          column: string;
          outcome: 'applied' | 'already_present' | 'refused';
          error: { code: string; message: string } | null;
        }[] = [];
        const appliedBefore: Record<string, Tag[]> = {};
        for (const columnId of columnIds) {
          const column = before.columns.get(columnId)!;
          if (column.directTags.includes(tag)) {
            results.push({ column: columnId, outcome: 'already_present', error: null });
          } else if (column.suppressedTags.includes(tag)) {
            results.push({
              column: columnId,
              outcome: 'refused',
              error: {
                code: 'tag_suppressed',
                message: `${tag} is suppressed on ${columnId}; lift the suppression first.`,
              },
            });
          } else {
            appliedBefore[columnId] = [...column.directTags];
            await addDirectTag(client, columnId, tag, seq);
            results.push({ column: columnId, outcome: 'applied', error: null });
          }
        }
        const appliedIds = Object.keys(appliedBefore);
        const batchId = appliedIds.length > 0 ? randomUUID() : null;
        const after = await loadCurrentSnapshot(client);
        if (batchId !== null) {
          await client.query(
            `INSERT INTO tag_batches (id, asset_id, tag, applied_seq, before_direct_tags)
             VALUES ($1,$2,$3,$4,$5)`,
            [batchId, assetId, tag, seq, JSON.stringify(appliedBefore)],
          );
          const afterTags: Record<string, Tag[]> = {};
          for (const columnId of appliedIds) afterTags[columnId] = directTagsOf(after, columnId);
          await appendAudit(client, seq, {
            actorId: current.userId,
            actorRole: current.role,
            action: 'tag.bulk_add',
            targetType: 'asset',
            targetId: assetId,
            before: { direct_tags: appliedBefore as unknown as Json },
            after: { batch_id: batchId, tag, direct_tags: afterTags as unknown as Json },
          });
        }
        return {
          status: 200,
          json: {
            batch_id: batchId,
            tag,
            requested: columnIds.length,
            applied: appliedIds.length,
            results,
            columns: columnIds.map((columnId) =>
              columnBody(after, after.columns.get(columnId)!, current.role),
            ),
            changed_columns: changedColumns(before, after),
          },
        };
      });
      if ('handle' in claim) await claim.handle.succeed(reply.status, reply.json);
      return reply;
    } catch (error) {
      if ('handle' in claim) await claim.handle.release();
      throw error;
    }
  });

  router.add('POST', '/api/tag-batches/:id/undo', async (ctx: Ctx): Promise<Reply> => {
    const batchId = ctx.params.id;
    let batch: {
      asset_id: string;
      applied_seq: string;
      before_direct_tags: Record<string, Tag[]>;
      undone_seq: string | null;
    } | null = null;
    return graphWrite(
      ctx,
      'tag.write',
      async (client) => {
        const result = await client.query<NonNullable<typeof batch>>(
          'SELECT asset_id, applied_seq, before_direct_tags, undone_seq FROM tag_batches WHERE id = $1',
          [batchId],
        );
        batch = result.rows[0] ?? null;
        if (batch === null) throw errors.notFound();
      },
      async ({ client, actor, before, seq }) => {
        const record = batch!;
        if (record.undone_seq !== null) {
          throw errors.conflict('batch_undone', 'This bulk tag apply was already undone.');
        }
        const appliedSeq = Number(record.applied_seq);
        const batchColumns = Object.keys(record.before_direct_tags);
        const history = await client.query<{ column_id: string }>(
          `SELECT column_id FROM (
             SELECT column_id, added_seq AS from_seq, removed_seq AS to_seq
               FROM column_tags WHERE column_id = ANY($1)
             UNION ALL
             SELECT column_id, created_seq AS from_seq, lifted_seq AS to_seq
               FROM suppressions WHERE column_id = ANY($1)
           ) changes
            WHERE from_seq > $2 OR to_seq > $2`,
          [batchColumns, appliedSeq],
        );
        const changed = sortIds(history.rows.map((row) => row.column_id));
        if (changed.length > 0) {
          throw errors.conflict(
            'batch_changed',
            `Undo refused: ${changed[0]} changed after the bulk apply.`,
          );
        }
        const auditBefore: Record<string, Tag[]> = {};
        for (const columnId of batchColumns) {
          const column = before.columns.get(columnId)!;
          const target = record.before_direct_tags[columnId];
          auditBefore[columnId] = [...column.directTags];
          for (const tag of column.directTags) {
            if (!target.includes(tag)) await removeDirectTag(client, columnId, tag, seq);
          }
          for (const tag of target) {
            if (!column.directTags.includes(tag)) await addDirectTag(client, columnId, tag, seq);
          }
        }
        await client.query('UPDATE tag_batches SET undone_seq = $2 WHERE id = $1', [batchId, seq]);
        return {
          action: 'tag.bulk_undo',
          targetType: 'asset',
          targetId: record.asset_id,
          auditBefore: { batch_id: batchId, direct_tags: auditBefore as unknown as Json },
          auditAfter: (after) => {
            const afterTags: Record<string, Tag[]> = {};
            for (const columnId of batchColumns) afterTags[columnId] = sortTags(directTagsOf(after, columnId));
            return { direct_tags: afterTags as unknown as Json };
          },
          status: 200,
          body: (after) => ({
            batch_id: batchId,
            restored: batchColumns.length,
            columns: batchColumns.map((columnId) =>
              columnBody(after, after.columns.get(columnId)!, actor.role),
            ),
            changed_columns: changedColumns(before, after),
          }),
        };
      },
    );
  });
}
