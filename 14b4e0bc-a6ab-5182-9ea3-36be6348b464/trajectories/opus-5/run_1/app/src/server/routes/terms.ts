import { randomUUID } from 'node:crypto';
import { codePointLength, compareIds } from '../../shared/domain.ts';
import { withReadTransaction } from '../db.ts';
import { latestSeq, loadSnapshot } from '../domain/snapshot.ts';
import { normaliseTermName, termNamesConflict } from '../domain/terms.ts';
import { assetDetail, glossaryOrder, termBody } from '../domain/views.ts';
import type { Ctx, Reply } from '../http/context.ts';
import { errors } from '../http/errors.ts';
import type { Router } from '../http/router.ts';
import { graphWrite } from './graphWrite.ts';

function validateTermFields(name: string | null, definition: string | null): void {
  const fields: Record<string, string> = {};
  if (name !== null) {
    const length = codePointLength(name);
    if (length < 1 || length > 80) fields.name = 'Use 1 to 80 characters.';
  }
  if (definition !== null) {
    const length = codePointLength(definition);
    if (length < 1 || length > 1000) fields.definition = 'Use 1 to 1,000 characters.';
  }
  if (Object.keys(fields).length > 0) throw errors.validation(fields);
}

export function registerTermRoutes(router: Router): void {
  router.add('GET', '/api/terms', async (ctx: Ctx): Promise<Reply> => {
    await ctx.requireActor();
    return withReadTransaction(async (client) => {
      const snapshot = await loadSnapshot(client, await latestSeq(client));
      return {
        status: 200,
        json: { terms: glossaryOrder(snapshot).map((term) => termBody(snapshot, term)) },
      };
    });
  });

  router.add('POST', '/api/terms', async (ctx: Ctx): Promise<Reply> => {
    const body = ctx.json();
    return graphWrite(
      ctx,
      'glossary.write',
      async () => undefined,
      async ({ client, before, seq }) => {
        const rawName = typeof body.name === 'string' ? body.name : '';
        const rawDefinition = typeof body.definition === 'string' ? body.definition : '';
        const name = normaliseTermName(rawName);
        const definition = rawDefinition;
        for (const term of before.terms.values()) {
          if (termNamesConflict(term.name, name)) {
            throw errors.conflict('term_exists', `A term named ${term.name} already exists.`);
          }
        }
        validateTermFields(name, definition);
        const termId = `t-${randomUUID()}`;
        await client.query('INSERT INTO terms (id, created_seq) VALUES ($1,$2)', [termId, seq]);
        await client.query(
          'INSERT INTO term_revisions (term_id, revision, name, definition, from_seq) VALUES ($1,1,$2,$3,$4)',
          [termId, name, definition, seq],
        );
        return {
          action: 'term.create',
          targetType: 'term',
          targetId: termId,
          auditBefore: null,
          auditAfter: () => ({ name, definition, revision: 1 }),
          status: 201,
          body: (after) => ({ term: termBody(after, after.terms.get(termId)!) }),
        };
      },
    );
  });

  router.add('PATCH', '/api/terms/:id', async (ctx: Ctx): Promise<Reply> => {
    const termId = ctx.params.id;
    const body = ctx.json();
    return graphWrite(
      ctx,
      'glossary.write',
      async (client) => {
        const result = await client.query('SELECT 1 FROM terms WHERE id = $1', [termId]);
        if ((result.rowCount ?? 0) === 0) throw errors.notFound();
      },
      async ({ client, before, seq }) => {
        const term = before.terms.get(termId);
        if (!term) throw errors.notFound();
        const revision = body.revision;
        if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 1) {
          throw errors.validation({ revision: 'Send the revision you edited.' });
        }
        if (revision !== term.revision) {
          throw errors.conflict('term_stale', 'This term changed since you opened it. Reload and try again.');
        }
        const hasName = typeof body.name === 'string';
        const hasDefinition = typeof body.definition === 'string';
        const name = hasName ? normaliseTermName(body.name as string) : term.name;
        const definition = hasDefinition ? (body.definition as string) : term.definition;
        for (const other of before.terms.values()) {
          if (other.id !== termId && termNamesConflict(other.name, name)) {
            throw errors.conflict('term_exists', `A term named ${other.name} already exists.`);
          }
        }
        validateTermFields(hasName ? name : null, hasDefinition ? definition : null);
        const nextRevision = term.revision + 1;
        await client.query(
          'INSERT INTO term_revisions (term_id, revision, name, definition, from_seq) VALUES ($1,$2,$3,$4,$5)',
          [termId, nextRevision, name, definition, seq],
        );
        const auditBefore: Record<string, unknown> = { revision: term.revision };
        const auditAfter: Record<string, unknown> = { revision: nextRevision };
        if (hasName) {
          auditBefore.name = term.name;
          auditAfter.name = name;
        }
        if (hasDefinition) {
          auditBefore.definition = term.definition;
          auditAfter.definition = definition;
        }
        return {
          action: 'term.update',
          targetType: 'term',
          targetId: termId,
          auditBefore: auditBefore as never,
          auditAfter: () => auditAfter as never,
          status: 200,
          body: (after) => ({ term: termBody(after, after.terms.get(termId)!) }),
        };
      },
    );
  });

  router.add('POST', '/api/assets/:id/terms', async (ctx: Ctx): Promise<Reply> => {
    const assetId = ctx.params.id;
    const body = ctx.json();
    return graphWrite(
      ctx,
      'glossary.write',
      async (client) => {
        const result = await client.query('SELECT 1 FROM assets WHERE id = $1', [assetId]);
        if ((result.rowCount ?? 0) === 0) throw errors.notFound();
      },
      async ({ client, actor, before, seq }) => {
        const asset = before.assets.get(assetId);
        if (!asset) throw errors.notFound();
        const termId = typeof body.term_id === 'string' ? body.term_id : '';
        const term = before.terms.get(termId);
        if (term && asset.termIds.includes(termId)) {
          throw errors.conflict('term_linked', `${term.name} is already linked.`);
        }
        if (!term) throw errors.validation({ term_id: 'Unknown term.' });
        await client.query('INSERT INTO asset_terms (asset_id, term_id, linked_seq) VALUES ($1,$2,$3)', [
          assetId,
          termId,
          seq,
        ]);
        return {
          action: 'term.link',
          targetType: 'asset',
          targetId: assetId,
          auditBefore: { terms: [...asset.termIds].sort(compareIds) },
          auditAfter: (after) => ({
            terms: [...(after.assets.get(assetId)?.termIds ?? [])].sort(compareIds),
          }),
          status: 200,
          body: (after) => assetDetail(after, after.assets.get(assetId)!, actor.role),
        };
      },
    );
  });

  router.add('DELETE', '/api/assets/:id/terms/:termId', async (ctx: Ctx): Promise<Reply> => {
    const assetId = ctx.params.id;
    const termId = ctx.params.termId;
    return graphWrite(
      ctx,
      'glossary.write',
      async (client) => {
        const result = await client.query(
          'SELECT 1 FROM asset_terms WHERE asset_id = $1 AND term_id = $2 AND unlinked_seq IS NULL',
          [assetId, termId],
        );
        if ((result.rowCount ?? 0) === 0) throw errors.notFound();
      },
      async ({ client, actor, before, seq }) => {
        const asset = before.assets.get(assetId)!;
        await client.query(
          'UPDATE asset_terms SET unlinked_seq = $3 WHERE asset_id = $1 AND term_id = $2 AND unlinked_seq IS NULL',
          [assetId, termId, seq],
        );
        return {
          action: 'term.unlink',
          targetType: 'asset',
          targetId: assetId,
          auditBefore: { terms: [...asset.termIds].sort(compareIds) },
          auditAfter: (after) => ({
            terms: [...(after.assets.get(assetId)?.termIds ?? [])].sort(compareIds),
          }),
          status: 200,
          body: (after) => assetDetail(after, after.assets.get(assetId)!, actor.role),
        };
      },
    );
  });
}
