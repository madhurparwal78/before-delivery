import {
  type CertificationState,
  type LineageDirection,
  type Tag,
  CERTIFICATION_STATES,
  codePointLength,
  compareIds,
  isTag,
} from '../../shared/domain.ts';
import { type Queryable, withReadTransaction } from '../db.ts';
import { traceLineage } from '../domain/lineage.ts';
import { type SearchFilters, runSearch } from '../domain/search.ts';
import { loadSnapshot } from '../domain/snapshot.ts';
import { assetDetail, columnBody, graphColumn } from '../domain/views.ts';
import type { Ctx, Reply } from '../http/context.ts';
import { errors } from '../http/errors.ts';
import { resolveAsOf, withAsOf } from '../http/pointInTime.ts';
import type { Router } from '../http/router.ts';

async function exists(client: Queryable, table: 'assets' | 'asset_columns', id: string): Promise<boolean> {
  const result = await client.query(`SELECT 1 FROM ${table} WHERE id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}

function readFilters(ctx: Ctx): SearchFilters {
  const rawQuery = (ctx.queryParam('q') ?? '').trim();
  const rawTag = ctx.queryParam('tag');
  const rawState = ctx.queryParam('state');
  const fields: Record<string, string> = {};
  if (codePointLength(rawQuery) > 200) fields.q = 'Search text must be 200 characters or fewer.';
  if (rawTag !== null && !isTag(rawTag)) fields.tag = 'Tag must be PII or Confidential.';
  if (rawState !== null && !CERTIFICATION_STATES.includes(rawState as CertificationState)) {
    fields.state = 'State must be draft, verified or deprecated.';
  }
  if (Object.keys(fields).length > 0) throw errors.validation(fields);
  return {
    q: rawQuery,
    tag: rawTag === null ? null : (rawTag as Tag),
    owner: ctx.queryParam('owner'),
    state: rawState === null ? null : (rawState as CertificationState),
    term: ctx.queryParam('term'),
  };
}

export function registerReadRoutes(router: Router): void {
  router.add('GET', '/api/search', async (ctx: Ctx): Promise<Reply> => {
    await ctx.requireActor();
    const filters = readFilters(ctx);
    return withReadTransaction(async (client) => {
      const asOf = await resolveAsOf(client, ctx);
      const snapshot = await loadSnapshot(client, asOf.seq);
      return { status: 200, json: withAsOf(asOf, runSearch(snapshot, filters)) };
    });
  });

  router.add('GET', '/api/assets/:id', async (ctx: Ctx): Promise<Reply> => {
    const actor = await ctx.requireActor();
    return withReadTransaction(async (client) => {
      if (!(await exists(client, 'assets', ctx.params.id))) throw errors.notFound();
      const asOf = await resolveAsOf(client, ctx);
      const snapshot = await loadSnapshot(client, asOf.seq);
      const asset = snapshot.assets.get(ctx.params.id);
      if (!asset) throw errors.notFound();
      const detail = assetDetail(snapshot, asset, actor.role);
      return {
        status: 200,
        json: asOf.explicit ? { as_of_seq: asOf.seq, as_of_at: asOf.at, asset: detail } : detail,
      };
    });
  });

  router.add('GET', '/api/columns/:id', async (ctx: Ctx): Promise<Reply> => {
    const actor = await ctx.requireActor();
    return withReadTransaction(async (client) => {
      if (!(await exists(client, 'asset_columns', ctx.params.id))) throw errors.notFound();
      const asOf = await resolveAsOf(client, ctx);
      const snapshot = await loadSnapshot(client, asOf.seq);
      const column = snapshot.columns.get(ctx.params.id);
      if (!column) throw errors.notFound();
      const asset = snapshot.assets.get(column.assetId);
      if (!asset) throw errors.notFound();
      const body = {
        ...columnBody(snapshot, column, actor.role),
        asset: { id: asset.id, state: asset.state },
      };
      return {
        status: 200,
        json: asOf.explicit ? { as_of_seq: asOf.seq, as_of_at: asOf.at, column: body } : body,
      };
    });
  });

  router.add('GET', '/api/graph', async (ctx: Ctx): Promise<Reply> => {
    await ctx.requireActor();
    return withReadTransaction(async (client) => {
      const asOf = await resolveAsOf(client, ctx);
      const snapshot = await loadSnapshot(client, asOf.seq);
      const columns = [...snapshot.columns.values()]
        .sort((a, b) => compareIds(a.id, b.id))
        .map((column) => graphColumn(snapshot, column));
      const edges = [...snapshot.edges.values()]
        .sort((a, b) => compareIds(a.from, b.from) || compareIds(a.to, b.to))
        .map((edge) => ({ id: edge.id, from: edge.from, to: edge.to, transform: edge.transform }));
      return { status: 200, json: withAsOf(asOf, { columns, edges }) };
    });
  });

  router.add('GET', '/api/columns/:id/lineage', async (ctx: Ctx): Promise<Reply> => {
    await ctx.requireActor();
    const rawDirection = ctx.queryParam('direction');
    if (rawDirection !== 'downstream' && rawDirection !== 'upstream') {
      throw errors.validation({ direction: 'Direction must be downstream or upstream.' });
    }
    const direction: LineageDirection = rawDirection;
    return withReadTransaction(async (client) => {
      if (!(await exists(client, 'asset_columns', ctx.params.id))) throw errors.notFound();
      const asOf = await resolveAsOf(client, ctx);
      const snapshot = await loadSnapshot(client, asOf.seq);
      if (!snapshot.columns.has(ctx.params.id)) throw errors.notFound();
      return {
        status: 200,
        json: withAsOf(asOf, traceLineage(snapshot, ctx.params.id, direction)),
      };
    });
  });
}
