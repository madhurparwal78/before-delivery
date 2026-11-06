import { randomUUID } from 'node:crypto';
import { type Transform, codePointLength, sortIds } from '../../shared/domain.ts';
import type { Json } from '../domain/audit.ts';
import {
  type ColumnInput,
  isValidAssetId,
  isValidColumnInput,
  isValidKind,
  isValidTransform,
} from '../domain/ingestion.ts';
import { changedColumns } from '../domain/tags.ts';
import { assetDetail } from '../domain/views.ts';
import type { Ctx, Reply } from '../http/context.ts';
import { errors } from '../http/errors.ts';
import type { Router } from '../http/router.ts';
import { graphWrite } from './graphWrite.ts';

interface EdgeInput {
  from: string;
  to: string;
  transform: Transform;
}

export function registerIngestionRoutes(router: Router): void {
  router.add('POST', '/api/assets', async (ctx: Ctx): Promise<Reply> => {
    const body = ctx.json();
    return graphWrite(
      ctx,
      'ingestion.write',
      async () => undefined,
      async ({ client, actor, before, seq }) => {
        const id = typeof body.id === 'string' ? body.id : '';
        if (before.assets.has(id)) {
          throw errors.conflict('asset_exists', `${id} is already registered.`);
        }
        const fields: Record<string, string> = {};
        if (!isValidAssetId(id)) {
          fields.id = 'Use schema.table in lowercase letters, digits and underscores.';
        }
        if (!isValidKind(body.kind)) fields.kind = 'Kind must be table, view or dashboard.';
        const description = typeof body.description === 'string' ? body.description : '';
        const descriptionLength = codePointLength(description);
        if (descriptionLength < 1 || descriptionLength > 500) {
          fields.description = 'Use 1 to 500 characters.';
        }
        const ownerId = typeof body.owner_id === 'string' ? body.owner_id : '';
        if (!before.users.has(ownerId)) fields.owner_id = 'Unknown user.';
        const rawColumns = Array.isArray(body.columns) ? body.columns : [];
        const names = rawColumns.map((column) =>
          column !== null && typeof column === 'object'
            ? String((column as Record<string, unknown>).name)
            : '',
        );
        if (rawColumns.length < 1 || rawColumns.length > 200 || new Set(names).size !== names.length) {
          fields.columns = 'Give 1 to 200 columns with unique names.';
        }
        rawColumns.forEach((column, index) => {
          if (!isValidColumnInput(column)) {
            fields[`columns[${index}]`] = "Check this column's name, type and samples.";
          }
        });
        if (Object.keys(fields).length > 0) throw errors.validation(fields);

        const columns = rawColumns as ColumnInput[];
        await client.query(
          'INSERT INTO assets (id, kind, description, owner_id, created_seq) VALUES ($1,$2,$3,$4,$5)',
          [id, body.kind, description, ownerId, seq],
        );
        await client.query(
          `INSERT INTO asset_certification (asset_id, from_seq, state, verified_at, evidence_id, deprecation)
           VALUES ($1,$2,'draft',NULL,NULL,NULL)`,
          [id, seq],
        );
        let ordinal = 0;
        for (const column of columns) {
          await client.query(
            `INSERT INTO asset_columns (id, asset_id, name, data_type, ordinal, samples, created_seq)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [
              `${id}.${column.name}`,
              id,
              column.name,
              column.data_type,
              ordinal,
              JSON.stringify(column.samples ?? []),
              seq,
            ],
          );
          ordinal += 1;
        }
        return {
          action: 'asset.register',
          targetType: 'asset',
          targetId: id,
          auditBefore: null,
          auditAfter: () => ({
            kind: body.kind as string,
            owner_id: ownerId,
            columns: columns.map((column) => column.name),
          }),
          status: 201,
          body: (after) => assetDetail(after, after.assets.get(id)!, actor.role),
        };
      },
    );
  });

  router.add('POST', '/api/lineage/edges', async (ctx: Ctx): Promise<Reply> => {
    const body = ctx.json();
    return graphWrite(
      ctx,
      'ingestion.write',
      async () => undefined,
      async ({ client, before, seq }) => {
        const rawEdges = Array.isArray(body.edges) ? body.edges : [];
        if (rawEdges.length < 1 || rawEdges.length > 1000) {
          throw errors.validation({ edges: 'Send 1 to 1,000 edges.' });
        }
        const fields: Record<string, string> = {};
        const entries = rawEdges.map((entry) =>
          entry !== null && typeof entry === 'object' ? (entry as Record<string, unknown>) : {},
        );
        entries.forEach((entry, index) => {
          const from = typeof entry.from === 'string' ? entry.from : '';
          const to = typeof entry.to === 'string' ? entry.to : '';
          if (!before.columns.has(from)) fields[`edges[${index}].from`] = 'Unknown column.';
          if (!before.columns.has(to)) fields[`edges[${index}].to`] = 'Unknown column.';
          else if (from === to) {
            fields[`edges[${index}].to`] = 'An edge cannot point to its own column.';
          }
          if (!isValidTransform(entry.transform)) {
            fields[`edges[${index}].transform`] =
              'Transform must be one of copy, rename, cast, filter, join, concat, hash, aggregate.';
          }
        });
        if (Object.keys(fields).length > 0) throw errors.validation(fields);

        const edges = entries as unknown as EdgeInput[];
        const seen = new Set<string>();
        for (let index = 0; index < edges.length; index += 1) {
          const edge = edges[index];
          const pair = `${edge.from}\u0000${edge.to}`;
          if (seen.has(pair) || before.liveEdge(edge.from, edge.to) !== null) {
            throw errors.conflict(
              'edge_exists',
              `An edge from ${edge.from} to ${edge.to} already exists.`,
            );
          }
          seen.add(pair);
        }

        const stored: { id: string; from: string; to: string; transform: Transform }[] = [];
        for (const edge of edges) {
          const edgeId = randomUUID();
          await client.query(
            `INSERT INTO lineage_edges (id, from_column, to_column, transform, added_seq)
             VALUES ($1,$2,$3,$4,$5)`,
            [edgeId, edge.from, edge.to, edge.transform, seq],
          );
          stored.push({ id: edgeId, from: edge.from, to: edge.to, transform: edge.transform });
        }
        return {
          action: 'lineage.add',
          targetType: 'lineage',
          targetId: stored[0].id,
          auditBefore: null,
          auditAfter: () => ({ edges: stored as unknown as Json }),
          status: 201,
          body: (after) => ({
            edges: stored,
            changed_columns: changedColumns(before, after),
          }),
        };
      },
    );
  });

  router.add('DELETE', '/api/lineage/edges/:id', async (ctx: Ctx): Promise<Reply> => {
    const edgeId = ctx.params.id;
    return graphWrite(
      ctx,
      'ingestion.write',
      async (client) => {
        const result = await client.query(
          'SELECT 1 FROM lineage_edges WHERE id = $1 AND removed_seq IS NULL',
          [edgeId],
        );
        if ((result.rowCount ?? 0) === 0) throw errors.notFound();
      },
      async ({ client, before, seq }) => {
        const edge = before.edges.get(edgeId);
        if (!edge) throw errors.notFound();
        await client.query('UPDATE lineage_edges SET removed_seq = $2 WHERE id = $1', [edgeId, seq]);
        return {
          action: 'lineage.remove',
          targetType: 'lineage',
          targetId: edgeId,
          auditBefore: {
            edge: { id: edge.id, from: edge.from, to: edge.to, transform: edge.transform },
          },
          auditAfter: () => null,
          status: 200,
          body: (after) => ({ changed_columns: sortIds(changedColumns(before, after)) }),
        };
      },
    );
  });
}
