import type { LayoutContent, StandardsProfile, VersionState } from '../../shared/protocol.js';
import { pool, tx } from '../db/pool.js';
import { newId } from '../domain/hash.js';
import { contentHash, sortContent } from '../domain/layout.js';
import { checkContent } from '../domain/rules.js';
import { errors } from '../errors.js';
import type { Route } from '../router.js';
import { commitLayout, lockLayout } from '../services/layoutStore.js';
import { requireLayout } from './layouts.js';

interface VersionRow {
  id: string;
  layout_id: string;
  number: number;
  state: VersionState;
  label: string;
  canonical_hash: string;
  saved_by: string;
  saved_at: Date;
  restored_from: number | null;
  revision: number;
}

const SUMMARY = `id, layout_id, number, state, label, canonical_hash, saved_by, saved_at,
  restored_from, revision::int as revision`;

function summary(row: VersionRow): Record<string, unknown> {
  return {
    id: row.id,
    number: row.number,
    state: row.state,
    label: row.label,
    canonical_hash: row.canonical_hash,
    saved_by: row.saved_by,
    saved_at: row.saved_at.toISOString(),
    restored_from: row.restored_from,
    revision: row.revision,
  };
}

async function requireVersion(layoutId: string, versionId: string): Promise<VersionRow> {
  const { rows } = await pool.query<VersionRow>(
    `select ${SUMMARY} from layout_versions where id = $1 and layout_id = $2`,
    [versionId, layoutId],
  );
  const row = rows[0];
  if (!row) throw errors.notFound();
  return row;
}

async function profileOf(workspaceId: string): Promise<StandardsProfile> {
  const { rows } = await pool.query<{ standards: StandardsProfile }>(
    `select standards from workspaces where id = $1`,
    [workspaceId],
  );
  return rows[0].standards;
}

export const versionRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/workspaces/:workspaceId/layouts/:layoutId/versions',
    auth: 'workspace',
    capability: 'read',
    handle: async (ctx) => {
      const layout = await requireLayout(ctx.workspaceId, ctx.params['layoutId']);
      const { rows } = await pool.query<VersionRow>(
        `select ${SUMMARY} from layout_versions where layout_id = $1 order by number`,
        [layout.id],
      );
      return { status: 200, body: { versions: rows.map(summary) } };
    },
  },
  {
    method: 'GET',
    path: '/api/workspaces/:workspaceId/layouts/:layoutId/versions/:versionId',
    auth: 'workspace',
    capability: 'read',
    handle: async (ctx) => {
      const layout = await requireLayout(ctx.workspaceId, ctx.params['layoutId']);
      const row = await requireVersion(layout.id, ctx.params['versionId']);
      const { rows } = await pool.query<{ content: LayoutContent }>(
        `select content from layout_versions where id = $1`,
        [row.id],
      );
      return { status: 200, body: { ...summary(row), content: rows[0].content } };
    },
  },
  {
    method: 'POST',
    path: '/api/workspaces/:workspaceId/layouts/:layoutId/versions',
    auth: 'workspace',
    capability: 'build',
    handle: async (ctx) => {
      await requireLayout(ctx.workspaceId, ctx.params['layoutId']);
      return ctx.once(async () =>
        tx(async (client) => {
          const layout = await lockLayout(client, ctx.params['layoutId'], ctx.workspaceId);
          if (!layout) throw errors.notFound();
          ctx.requireRevision(layout.revision);
          const label = ctx.optionalText('label', 120);

          const numbers = await client.query<{ next: number }>(
            `select coalesce(max(number), 0) + 1 as next from layout_versions where layout_id = $1`,
            [layout.id],
          );
          const number = numbers.rows[0].next;
          const content = sortContent(layout.content);
          const id = newId('ver');
          await client.query(
            `insert into layout_versions
               (id, layout_id, number, state, canonical_hash, content, label, saved_by, restored_from)
             values ($1, $2, $3, 'Draft', $4, $5, $6, $7, null)`,
            [
              id,
              layout.id,
              number,
              contentHash(content),
              JSON.stringify(content),
              label,
              ctx.person.display_name,
            ],
          );
          const committed = await commitLayout(
            client,
            layout,
            'version.changed',
            ctx.person,
            { version_id: id, version_number: number, state: 'Draft' },
            [{ action: 'version.saved', object_id: id, from: null, to: String(number) }],
          );
          const row = await client.query<VersionRow>(
            `select ${SUMMARY} from layout_versions where id = $1`,
            [id],
          );
          return {
            status: 201,
            body: { version: summary(row.rows[0]), layout_revision: committed.revision },
          };
        }),
      );
    },
  },
  {
    method: 'POST',
    path: '/api/workspaces/:workspaceId/layouts/:layoutId/versions/:versionId/validate',
    auth: 'workspace',
    capability: 'build',
    handle: async (ctx) => {
      const layout = await requireLayout(ctx.workspaceId, ctx.params['layoutId']);
      const version = await requireVersion(layout.id, ctx.params['versionId']);
      return ctx.once(async () => {
        ctx.requireRevision(version.revision);
        if (version.state !== 'Draft') throw errors.versionTransition(version.state);
        const profile = await profileOf(ctx.workspaceId);
        const { rows } = await pool.query<{ content: LayoutContent }>(
          `select content from layout_versions where id = $1`,
          [version.id],
        );
        const findings = checkContent(rows[0].content, profile);
        if (findings.length > 0) throw errors.versionRules(findings);

        const updated = await pool.query<VersionRow>(
          `update layout_versions set state = 'Validated', revision = revision + 1
           where id = $1 returning ${SUMMARY}`,
          [version.id],
        );
        return {
          status: 200,
          body: {
            version: summary(updated.rows[0]),
            report: { passed: true, findings: [] },
          },
        };
      });
    },
  },
  {
    method: 'POST',
    path: '/api/workspaces/:workspaceId/layouts/:layoutId/versions/:versionId/publish',
    auth: 'workspace',
    capability: 'manage',
    handle: async (ctx) => {
      const layout = await requireLayout(ctx.workspaceId, ctx.params['layoutId']);
      const version = await requireVersion(layout.id, ctx.params['versionId']);
      return ctx.once(async () => {
        ctx.requireRevision(version.revision);
        if (version.state !== 'Validated') throw errors.versionTransition(version.state);
        const updated = await pool.query<VersionRow>(
          `update layout_versions set state = 'Published', revision = revision + 1
           where id = $1 returning ${SUMMARY}`,
          [version.id],
        );
        return { status: 200, body: { version: summary(updated.rows[0]) } };
      });
    },
  },
  {
    method: 'POST',
    path: '/api/workspaces/:workspaceId/layouts/:layoutId/versions/:versionId/restore',
    auth: 'workspace',
    capability: 'manage',
    handle: async (ctx) => {
      const layout = await requireLayout(ctx.workspaceId, ctx.params['layoutId']);
      const source = await requireVersion(layout.id, ctx.params['versionId']);
      return ctx.once(async () =>
        tx(async (client) => {
          const working = await lockLayout(client, ctx.params['layoutId'], ctx.workspaceId);
          if (!working) throw errors.notFound();
          ctx.requireRevision(working.revision);

          const stored = await client.query<{ content: LayoutContent }>(
            `select content from layout_versions where id = $1`,
            [source.id],
          );
          const content = stored.rows[0].content;
          const numbers = await client.query<{ next: number }>(
            `select coalesce(max(number), 0) + 1 as next from layout_versions where layout_id = $1`,
            [working.id],
          );
          const number = numbers.rows[0].next;
          const id = newId('ver');
          await client.query(
            `insert into layout_versions
               (id, layout_id, number, state, canonical_hash, content, label, saved_by, restored_from)
             values ($1, $2, $3, 'Draft', $4, $5, $6, $7, $8)`,
            [
              id,
              working.id,
              number,
              source.canonical_hash,
              JSON.stringify(content),
              source.label,
              ctx.person.display_name,
              source.number,
            ],
          );

          working.content = content;
          working.module_revisions = Object.fromEntries(
            content.modules.map((module) => [module.id, working.module_revisions[module.id] ?? 0]),
          );
          const committed = await commitLayout(
            client,
            working,
            'version.changed',
            ctx.person,
            { version_id: id, version_number: number, restored_from: source.number },
            [
              {
                action: 'version.restored',
                object_id: id,
                from: String(source.number),
                to: String(number),
              },
            ],
          );
          const row = await client.query<VersionRow>(
            `select ${SUMMARY} from layout_versions where id = $1`,
            [id],
          );
          return {
            status: 201,
            body: {
              version: summary(row.rows[0]),
              layout_revision: committed.revision,
              working_hash: committed.working_hash,
            },
          };
        }),
      );
    },
  },
];
