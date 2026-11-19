import type {
  BlockContent,
  Endplate,
  ModuleContent,
  OpenEnd,
  StandardsProfile,
  TimetableEntry,
} from '../../shared/protocol.js';
import { pool, tx } from '../db/pool.js';
import { newId } from '../domain/hash.js';
import {
  buildPiece,
  chainAncestors,
  contentHash,
  countsOf,
  emptyContent,
  exitPose,
  findModule,
  hasFollowers,
  makeModule,
  makeOpenEnd,
  moduleOrigin,
  nextBlockNumber,
  nextEndLabel,
  openEndExits,
  relayoutModule,
  searchBlocks,
} from '../domain/layout.js';
import { checkContent, checkPiece } from '../domain/rules.js';
import { errors } from '../errors.js';
import type { Route } from '../router.js';
import {
  commitLayout,
  historyOf,
  loadLayout,
  lockLayout,
  type LayoutRow,
  type TrashedModule,
} from '../services/layoutStore.js';
import { propagateRename } from '../services/renames.js';
import { parsePieceInput } from './pieceInput.js';

async function profileOf(workspaceId: string): Promise<StandardsProfile> {
  const { rows } = await pool.query<{ standards: StandardsProfile }>(
    `select standards from workspaces where id = $1`,
    [workspaceId],
  );
  const row = rows[0];
  if (!row) throw errors.notFound();
  return row.standards;
}

async function requireLayout(workspaceId: string, layoutId: string): Promise<LayoutRow> {
  const layout = await loadLayout(layoutId, workspaceId);
  if (!layout) throw errors.notFound();
  return layout;
}

function parseEndplates(raw: unknown): Endplate[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 2) throw errors.invalidFields();
  return raw.map((entry) => {
    if (entry === null || typeof entry !== 'object') throw errors.invalidFields();
    const row = entry as Record<string, unknown>;
    const end = row['end'];
    const width = row['width_mm'];
    const offsets = row['track_offsets_mm'];
    if (typeof end !== 'string' || end.length < 1 || end.length > 8) throw errors.invalidFields();
    if (!Number.isInteger(width) || (width as number) < 1) throw errors.invalidFields();
    if (!Array.isArray(offsets) || offsets.length < 1 || offsets.length > 2) {
      throw errors.invalidFields();
    }
    for (const offset of offsets) if (!Number.isInteger(offset)) throw errors.invalidFields();
    return {
      end,
      width_mm: width as number,
      track_offsets_mm: offsets as number[],
    };
  });
}

function moduleOf(layout: LayoutRow, moduleId: string): ModuleContent {
  const module = findModule(layout.content, moduleId);
  if (!module) throw errors.notFound();
  return module;
}

function bumpModule(layout: LayoutRow, moduleId: string): number {
  const next = (layout.module_revisions[moduleId] ?? 0) + 1;
  layout.module_revisions[moduleId] = next;
  return next;
}

async function nextTimetableVersion(layoutId: string, current: number): Promise<number> {
  const { rows } = await pool.query<{ highest: number | null }>(
    `select max((content->'timetable'->>'version')::int) as highest
     from layout_versions where layout_id = $1`,
    [layoutId],
  );
  return Math.max(current, rows[0]?.highest ?? 0) + 1;
}

export const layoutRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/workspaces/:workspaceId/layouts',
    auth: 'workspace',
    capability: 'read',
    handle: async (ctx) => {
      const { rows } = await pool.query<LayoutRow>(
        `select id, workspace_id, name, content, module_revisions, trash, consumed_ends,
                revision::int as revision
         from layouts where workspace_id = $1 order by name`,
        [ctx.workspaceId],
      );
      return {
        status: 200,
        body: {
          layouts: rows.map((layout) => ({
            id: layout.id,
            name: layout.name,
            revision: layout.revision,
            counts: countsOf(layout.content, layout.trash.length),
          })),
        },
      };
    },
  },
  {
    method: 'POST',
    path: '/api/workspaces/:workspaceId/layouts',
    auth: 'workspace',
    capability: 'build',
    handle: async (ctx) =>
      ctx.once(async () => {
        const name = ctx.text('name', 120);
        const content = emptyContent();
        const id = newId('lay');
        await pool.query(
          `insert into layouts (id, workspace_id, name, content) values ($1, $2, $3, $4)`,
          [id, ctx.workspaceId, name, JSON.stringify(content)],
        );
        return {
          status: 201,
          body: {
            layout: {
              id,
              name,
              revision: 0,
              working_hash: contentHash(content),
              counts: countsOf(content, 0),
            },
          },
        };
      }),
  },
  {
    method: 'GET',
    path: '/api/workspaces/:workspaceId/layouts/:layoutId',
    auth: 'workspace',
    capability: 'read',
    handle: async (ctx) => {
      const layout = await requireLayout(ctx.workspaceId, ctx.params['layoutId']);
      return {
        status: 200,
        body: {
          id: layout.id,
          name: layout.name,
          revision: layout.revision,
          working_hash: contentHash(layout.content),
          content: layout.content,
          module_revisions: layout.module_revisions,
          counts: countsOf(layout.content, layout.trash.length),
        },
      };
    },
  },
  {
    method: 'GET',
    path: '/api/workspaces/:workspaceId/layouts/:layoutId/blocks',
    auth: 'workspace',
    capability: 'read',
    handle: async (ctx) => {
      const layout = await requireLayout(ctx.workspaceId, ctx.params['layoutId']);
      return {
        status: 200,
        body: {
          blocks: searchBlocks(layout.content, ctx.query.get('q') ?? '').map((block) => ({
            id: block.id,
            number: block.number,
            name: block.name,
            kind: block.kind,
          })),
        },
      };
    },
  },
  {
    method: 'POST',
    path: '/api/workspaces/:workspaceId/layouts/:layoutId/check',
    auth: 'workspace',
    capability: 'build',
    handle: async (ctx) => {
      const layout = await requireLayout(ctx.workspaceId, ctx.params['layoutId']);
      const findings = checkContent(layout.content, await profileOf(ctx.workspaceId));
      return { status: 200, body: { passed: findings.length === 0, findings } };
    },
  },
  {
    method: 'POST',
    path: '/api/workspaces/:workspaceId/layouts/:layoutId/modules',
    auth: 'workspace',
    capability: 'build',
    handle: async (ctx) => {
      await requireLayout(ctx.workspaceId, ctx.params['layoutId']);
      return ctx.once(async () =>
        tx(async (client) => {
          const layout = await lockLayout(client, ctx.params['layoutId'], ctx.workspaceId);
          if (!layout) throw errors.notFound();
          ctx.requireRevision(layout.revision);
          const name = ctx.text('name', 120);
          const endplates = parseEndplates(ctx.body['endplates']);
          const module = makeModule(name, endplates, moduleOrigin(layout.content));
          layout.content.modules.push(module);
          layout.module_revisions[module.id] = 0;
          const committed = await commitLayout(
            client,
            layout,
            'module.changed',
            ctx.person,
            { module_id: module.id, change: 'added' },
            [{ action: 'module.added', object_id: module.id, from: null, to: name }],
          );
          return {
            status: 201,
            body: { module, layout_revision: committed.revision },
          };
        }),
      );
    },
  },
  {
    method: 'POST',
    path: '/api/workspaces/:workspaceId/layouts/:layoutId/modules/:moduleId/trash',
    auth: 'workspace',
    capability: 'build',
    handle: async (ctx) => {
      const preflight = await requireLayout(ctx.workspaceId, ctx.params['layoutId']);
      moduleOf(preflight, ctx.params['moduleId']);
      return ctx.once(async () =>
        tx(async (client) => {
          const layout = await lockLayout(client, ctx.params['layoutId'], ctx.workspaceId);
          if (!layout) throw errors.notFound();
          ctx.requireRevision(layout.revision);
          const moduleId = ctx.params['moduleId'];
          const module = moduleOf(layout, moduleId);
          const blocks = layout.content.blocks.filter((block) => block.module_id === moduleId);
          const blockIds = new Set(blocks.map((block) => block.id));
          const removedRefs: { block_id: string; side: 'east' | 'west'; other_id: string }[] = [];

          for (const block of layout.content.blocks) {
            if (blockIds.has(block.id)) continue;
            for (const side of ['east', 'west'] as const) {
              const list = side === 'east' ? block.east_neighbour_ids : block.west_neighbour_ids;
              for (const otherId of [...list]) {
                if (!blockIds.has(otherId)) continue;
                removedRefs.push({ block_id: block.id, side, other_id: otherId });
                list.splice(list.indexOf(otherId), 1);
              }
            }
          }

          const entry: TrashedModule & {
            removed_refs: { block_id: string; side: 'east' | 'west'; other_id: string }[];
          } = {
            id: module.id,
            name: module.name,
            module: JSON.parse(JSON.stringify(module)) as ModuleContent,
            blocks: JSON.parse(JSON.stringify(blocks)) as BlockContent[],
            module_revision: layout.module_revisions[moduleId] ?? 0,
            trashed_by: ctx.person.display_name,
            trashed_at: new Date().toISOString(),
            removed_refs: removedRefs,
          };
          layout.trash.push(entry);
          layout.content.modules = layout.content.modules.filter((row) => row.id !== moduleId);
          layout.content.blocks = layout.content.blocks.filter((row) => !blockIds.has(row.id));

          const committed = await commitLayout(
            client,
            layout,
            'module.changed',
            ctx.person,
            { module_id: moduleId, change: 'trashed' },
            [{ action: 'module.trashed', object_id: moduleId, from: module.name, to: null }],
          );
          return {
            status: 200,
            body: { layout_revision: committed.revision, working_hash: committed.working_hash },
          };
        }),
      );
    },
  },
  {
    method: 'POST',
    path: '/api/workspaces/:workspaceId/layouts/:layoutId/trash/:moduleId/undo',
    auth: 'workspace',
    capability: 'manage',
    handle: async (ctx) => {
      const preflight = await requireLayout(ctx.workspaceId, ctx.params['layoutId']);
      if (!preflight.trash.some((entry) => entry.id === ctx.params['moduleId'])) {
        throw errors.notFound();
      }
      return ctx.once(async () =>
        tx(async (client) => {
          const layout = await lockLayout(client, ctx.params['layoutId'], ctx.workspaceId);
          if (!layout) throw errors.notFound();
          ctx.requireRevision(layout.revision);
          const index = layout.trash.findIndex((row) => row.id === ctx.params['moduleId']);
          if (index < 0) throw errors.notFound();
          const entry = layout.trash[index] as TrashedModule & {
            removed_refs?: { block_id: string; side: 'east' | 'west'; other_id: string }[];
          };
          layout.trash.splice(index, 1);
          layout.content.modules.push(entry.module);
          layout.content.blocks.push(...entry.blocks);
          layout.module_revisions[entry.id] = entry.module_revision;
          for (const ref of entry.removed_refs ?? []) {
            const block = layout.content.blocks.find((row) => row.id === ref.block_id);
            if (!block) continue;
            const list = ref.side === 'east' ? block.east_neighbour_ids : block.west_neighbour_ids;
            if (!list.includes(ref.other_id)) list.push(ref.other_id);
          }

          const committed = await commitLayout(
            client,
            layout,
            'module.changed',
            ctx.person,
            { module_id: entry.id, change: 'restored' },
            [{ action: 'module.restored', object_id: entry.id, from: null, to: entry.name }],
          );
          return {
            status: 200,
            body: {
              module: entry.module,
              layout_revision: committed.revision,
              working_hash: committed.working_hash,
            },
          };
        }),
      );
    },
  },
  {
    method: 'POST',
    path: '/api/workspaces/:workspaceId/layouts/:layoutId/trash/:moduleId/purge',
    auth: 'workspace',
    capability: 'manage',
    handle: async (ctx) => {
      const preflight = await requireLayout(ctx.workspaceId, ctx.params['layoutId']);
      if (!preflight.trash.some((entry) => entry.id === ctx.params['moduleId'])) {
        throw errors.notFound();
      }
      return ctx.once(async () =>
        tx(async (client) => {
          const layout = await lockLayout(client, ctx.params['layoutId'], ctx.workspaceId);
          if (!layout) throw errors.notFound();
          ctx.requireRevision(layout.revision);
          const moduleId = ctx.params['moduleId'];
          const index = layout.trash.findIndex((row) => row.id === moduleId);
          if (index < 0) throw errors.notFound();
          const entry = layout.trash[index];
          layout.trash.splice(index, 1);
          delete layout.module_revisions[moduleId];

          const objectIds = [moduleId, ...entry.module.pieces.map((piece) => piece.id)];
          await client.query(
            `update layout_history set action = 'purged', object_id = null,
                    from_value = null, to_value = null
             where layout_id = $1 and object_id = any($2::text[])`,
            [layout.id, objectIds],
          );

          const committed = await commitLayout(
            client,
            layout,
            'module.changed',
            ctx.person,
            { module_id: moduleId, change: 'purged' },
            [{ action: 'purged', object_id: null, from: null, to: null }],
          );
          return { status: 200, body: { layout_revision: committed.revision } };
        }),
      );
    },
  },
  {
    method: 'GET',
    path: '/api/workspaces/:workspaceId/layouts/:layoutId/trash',
    auth: 'workspace',
    capability: 'read',
    handle: async (ctx) => {
      const layout = await requireLayout(ctx.workspaceId, ctx.params['layoutId']);
      return {
        status: 200,
        body: {
          modules: layout.trash.map((entry) => ({
            id: entry.id,
            name: entry.name,
            trashed_by: entry.trashed_by,
            trashed_at: entry.trashed_at,
          })),
        },
      };
    },
  },
  {
    method: 'POST',
    path: '/api/workspaces/:workspaceId/layouts/:layoutId/modules/:moduleId/pieces',
    auth: 'workspace',
    capability: 'build',
    handle: async (ctx) => {
      const preflight = await requireLayout(ctx.workspaceId, ctx.params['layoutId']);
      const preModule = moduleOf(preflight, ctx.params['moduleId']);
      const openEndId = ctx.body['open_end_id'];
      if (typeof openEndId !== 'string') throw errors.invalidFields();
      const known =
        preModule.open_ends.some((end) => end.id === openEndId) ||
        preflight.consumed_ends[openEndId] !== undefined;
      if (!known) throw errors.notFound();

      return ctx.once(async () => {
        const profile = await profileOf(ctx.workspaceId);
        return tx(async (client) => {
          const layout = await lockLayout(client, ctx.params['layoutId'], ctx.workspaceId);
          if (!layout) throw errors.notFound();
          const module = moduleOf(layout, ctx.params['moduleId']);
          const open = module.open_ends.find((end) => end.id === openEndId);
          if (!open) {
            const taken = layout.consumed_ends[openEndId];
            if (!taken) throw errors.notFound();
            throw errors.openEndTaken(taken.label, taken.taken_by, taken.piece_id);
          }
          ctx.requireRevision(layout.module_revisions[module.id] ?? 0);

          const input = parsePieceInput(ctx.body['piece']);
          const attachments = openEndExits(module);
          const place = attachments.get(open.id);
          const parent = place
            ? module.pieces.find((piece) => piece.id === place.pieceId)
            : undefined;
          const piece = buildPiece(
            input,
            { x_mm: open.x_mm, y_mm: open.y_mm, elevation_mm: open.elevation_mm, heading_deg: open.heading_deg },
            parent?.block_id ?? null,
            ctx.person.display_name,
            { piece_id: parent?.id ?? null, exit: place?.exit ?? 'end' },
          );

          const findings = checkPiece(
            piece,
            parent ? [...chainAncestors(module.pieces, parent), parent] : [],
            module.id,
            profile,
          );
          if (findings.length > 0) throw errors.pieceRules(findings);

          module.open_ends = module.open_ends.filter((end) => end.id !== open.id);
          module.pieces.push(piece);
          const labels = new Set(module.open_ends.map((end) => end.label));
          const replacements: OpenEnd[] = [makeOpenEnd(open.label, exitPose(piece, 'end'))];
          labels.add(open.label);
          if (piece.kind === 'turnout') {
            replacements.push(makeOpenEnd(nextEndLabel(labels), exitPose(piece, 'branch')));
          }
          module.open_ends.push(...replacements);
          layout.consumed_ends[open.id] = {
            label: open.label,
            piece_id: piece.id,
            taken_by: ctx.person.display_name,
          };
          const moduleRevision = bumpModule(layout, module.id);

          const committed = await commitLayout(
            client,
            layout,
            'piece.added',
            ctx.person,
            { module_id: module.id, piece_id: piece.id, open_end_id: open.id },
            [{ action: 'piece.added', object_id: piece.id, from: null, to: piece.kind }],
          );
          return {
            status: 201,
            body: {
              piece,
              open_ends: module.open_ends,
              module_revision: moduleRevision,
              layout_revision: committed.revision,
              working_hash: committed.working_hash,
            },
          };
        });
      });
    },
  },
  {
    method: 'PATCH',
    path: '/api/workspaces/:workspaceId/layouts/:layoutId/modules/:moduleId/pieces/:pieceId',
    auth: 'workspace',
    capability: 'build',
    handle: async (ctx) => {
      const preflight = await requireLayout(ctx.workspaceId, ctx.params['layoutId']);
      const preModule = moduleOf(preflight, ctx.params['moduleId']);
      if (!preModule.pieces.some((piece) => piece.id === ctx.params['pieceId'])) {
        throw errors.notFound();
      }
      return ctx.once(async () => {
        const profile = await profileOf(ctx.workspaceId);
        return tx(async (client) => {
          const layout = await lockLayout(client, ctx.params['layoutId'], ctx.workspaceId);
          if (!layout) throw errors.notFound();
          const module = moduleOf(layout, ctx.params['moduleId']);
          const piece = module.pieces.find((row) => row.id === ctx.params['pieceId']);
          if (!piece) throw errors.notFound();
          ctx.requireRevision(layout.module_revisions[module.id] ?? 0);

          if (ctx.body['rise_mm'] !== undefined) {
            const rise = ctx.body['rise_mm'];
            if (!Number.isInteger(rise) || Math.abs(rise as number) > 2000) {
              throw errors.invalidFields();
            }
            piece.rise_mm = rise as number;
          }
          if (ctx.body['block_id'] !== undefined) {
            const blockId = ctx.optionalId('block_id');
            if (blockId && !layout.content.blocks.some((block) => block.id === blockId)) {
              throw errors.invalidFields();
            }
            piece.block_id = blockId;
          }
          if (ctx.body['note'] !== undefined) piece.note = ctx.optionalText('note', 2000);

          relayoutModule(module);
          const findings = checkPiece(
            piece,
            chainAncestors(module.pieces, piece),
            module.id,
            profile,
          );
          if (findings.length > 0) throw errors.pieceRules(findings);

          const moduleRevision = bumpModule(layout, module.id);
          const committed = await commitLayout(
            client,
            layout,
            'piece.changed',
            ctx.person,
            { module_id: module.id, piece_id: piece.id },
            [{ action: 'piece.changed', object_id: piece.id, from: null, to: piece.block_id }],
          );
          return {
            status: 200,
            body: {
              piece,
              module_revision: moduleRevision,
              layout_revision: committed.revision,
              working_hash: committed.working_hash,
            },
          };
        });
      });
    },
  },
  {
    method: 'POST',
    path: '/api/workspaces/:workspaceId/layouts/:layoutId/modules/:moduleId/pieces/:pieceId/remove',
    auth: 'workspace',
    capability: 'build',
    handle: async (ctx) => {
      const preflight = await requireLayout(ctx.workspaceId, ctx.params['layoutId']);
      const preModule = moduleOf(preflight, ctx.params['moduleId']);
      if (!preModule.pieces.some((piece) => piece.id === ctx.params['pieceId'])) {
        throw errors.notFound();
      }
      return ctx.once(async () =>
        tx(async (client) => {
          const layout = await lockLayout(client, ctx.params['layoutId'], ctx.workspaceId);
          if (!layout) throw errors.notFound();
          const module = moduleOf(layout, ctx.params['moduleId']);
          const piece = module.pieces.find((row) => row.id === ctx.params['pieceId']);
          if (!piece) throw errors.notFound();
          ctx.requireRevision(layout.module_revisions[module.id] ?? 0);
          if (hasFollowers(module.pieces, piece)) throw errors.pieceHasFollowers();

          const attachments = openEndExits(module);
          const freedLabels: string[] = [];
          module.open_ends = module.open_ends.filter((end) => {
            const place = attachments.get(end.id);
            if (place && place.pieceId === piece.id) {
              freedLabels.push(end.label);
              return false;
            }
            return true;
          });
          module.pieces = module.pieces.filter((row) => row.id !== piece.id);
          const label =
            freedLabels[0] ?? nextEndLabel(module.open_ends.map((end) => end.label));
          module.open_ends.push(makeOpenEnd(label, { ...piece.start }));
          for (const [endId, record] of Object.entries(layout.consumed_ends)) {
            if (record.piece_id === piece.id) delete layout.consumed_ends[endId];
          }

          const moduleRevision = bumpModule(layout, module.id);
          const committed = await commitLayout(
            client,
            layout,
            'piece.removed',
            ctx.person,
            { module_id: module.id, piece_id: piece.id },
            [{ action: 'piece.removed', object_id: piece.id, from: piece.kind, to: null }],
          );
          return {
            status: 200,
            body: {
              open_ends: module.open_ends,
              module_revision: moduleRevision,
              layout_revision: committed.revision,
              working_hash: committed.working_hash,
            },
          };
        }),
      );
    },
  },
  {
    method: 'POST',
    path: '/api/workspaces/:workspaceId/layouts/:layoutId/blocks',
    auth: 'workspace',
    capability: 'build',
    handle: async (ctx) => {
      await requireLayout(ctx.workspaceId, ctx.params['layoutId']);
      return ctx.once(async () =>
        tx(async (client) => {
          const layout = await lockLayout(client, ctx.params['layoutId'], ctx.workspaceId);
          if (!layout) throw errors.notFound();
          ctx.requireRevision(layout.revision);
          const name = ctx.text('name', 120);
          const kind = ctx.choice('kind', ['plain', 'loop', 'approach'] as const);
          const block: BlockContent = {
            id: newId('blk'),
            number: nextBlockNumber(layout.content),
            name,
            kind,
            length_mm: 0,
            module_id: null,
            station_id: null,
            east_neighbour_ids: [],
            west_neighbour_ids: [],
          };
          layout.content.blocks.push(block);
          const committed = await commitLayout(
            client,
            layout,
            'module.changed',
            ctx.person,
            { block_id: block.id, change: 'added' },
            [{ action: 'block.added', object_id: block.id, from: null, to: name }],
          );
          return { status: 201, body: { block, layout_revision: committed.revision } };
        }),
      );
    },
  },
  {
    method: 'PATCH',
    path: '/api/workspaces/:workspaceId/layouts/:layoutId/blocks/:blockId',
    auth: 'workspace',
    capability: 'manage',
    handle: async (ctx) => {
      const preflight = await requireLayout(ctx.workspaceId, ctx.params['layoutId']);
      if (!preflight.content.blocks.some((block) => block.id === ctx.params['blockId'])) {
        throw errors.notFound();
      }
      return ctx.once(async () =>
        tx(async (client) => {
          const layout = await lockLayout(client, ctx.params['layoutId'], ctx.workspaceId);
          if (!layout) throw errors.notFound();
          const block = layout.content.blocks.find((row) => row.id === ctx.params['blockId']);
          if (!block) throw errors.notFound();
          ctx.requireRevision(layout.revision);
          const name = ctx.text('name', 120);
          const previous = block.name;
          block.name = name;
          const committed = await commitLayout(
            client,
            layout,
            'name.changed',
            ctx.person,
            { kind: 'block', object_id: block.id, from: previous, to: name },
            [{ action: 'block.renamed', object_id: block.id, from: previous, to: name }],
          );
          await propagateRename(client, layout.id, 'block', block.id, name);
          return { status: 200, body: { block, layout_revision: committed.revision } };
        }),
      );
    },
  },
  {
    method: 'PATCH',
    path: '/api/workspaces/:workspaceId/layouts/:layoutId/stations/:stationId',
    auth: 'workspace',
    capability: 'manage',
    handle: async (ctx) => {
      const preflight = await requireLayout(ctx.workspaceId, ctx.params['layoutId']);
      if (!preflight.content.stations.some((row) => row.id === ctx.params['stationId'])) {
        throw errors.notFound();
      }
      return ctx.once(async () =>
        tx(async (client) => {
          const layout = await lockLayout(client, ctx.params['layoutId'], ctx.workspaceId);
          if (!layout) throw errors.notFound();
          const station = layout.content.stations.find(
            (row) => row.id === ctx.params['stationId'],
          );
          if (!station) throw errors.notFound();
          ctx.requireRevision(layout.revision);
          const name = ctx.text('name', 120);
          const previous = station.name;
          station.name = name;
          const committed = await commitLayout(
            client,
            layout,
            'name.changed',
            ctx.person,
            { kind: 'station', object_id: station.id, from: previous, to: name },
            [{ action: 'station.renamed', object_id: station.id, from: previous, to: name }],
          );
          await propagateRename(client, layout.id, 'station', station.id, name);
          return { status: 200, body: { station, layout_revision: committed.revision } };
        }),
      );
    },
  },
  {
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/layouts/:layoutId/timetable',
    auth: 'workspace',
    capability: 'manage',
    handle: async (ctx) => {
      await requireLayout(ctx.workspaceId, ctx.params['layoutId']);
      return ctx.once(async () =>
        tx(async (client) => {
          const layout = await lockLayout(client, ctx.params['layoutId'], ctx.workspaceId);
          if (!layout) throw errors.notFound();
          ctx.requireRevision(layout.revision);

          const raw = ctx.body['entries'];
          if (!Array.isArray(raw)) throw errors.invalidFields();
          const trains = new Set(layout.content.trains.map((train) => train.id));
          const stations = new Set(layout.content.stations.map((station) => station.id));
          const entries: TimetableEntry[] = raw.map((item) => {
            if (item === null || typeof item !== 'object') throw errors.invalidFields();
            const row = item as Record<string, unknown>;
            const id = row['id'];
            const trainId = row['train_id'];
            const stationId = row['station_id'];
            const depart = row['depart_fast_seconds'];
            if (typeof id !== 'string' || id === '') throw errors.invalidFields();
            if (typeof trainId !== 'string' || !trains.has(trainId)) throw errors.invalidFields();
            if (typeof stationId !== 'string' || !stations.has(stationId)) {
              throw errors.invalidFields();
            }
            if (!Number.isInteger(depart) || (depart as number) < 0 || (depart as number) > 86399) {
              throw errors.invalidFields();
            }
            return {
              id,
              train_id: trainId,
              station_id: stationId,
              depart_fast_seconds: depart as number,
            };
          });

          const version = await nextTimetableVersion(layout.id, layout.content.timetable.version);
          layout.content.timetable = { version, entries };
          const committed = await commitLayout(
            client,
            layout,
            'timetable.changed',
            ctx.person,
            { timetable_version: version },
            [
              {
                action: 'timetable.saved',
                object_id: null,
                from: null,
                to: String(version),
              },
            ],
          );
          return {
            status: 200,
            body: {
              timetable: layout.content.timetable,
              layout_revision: committed.revision,
            },
          };
        }),
      );
    },
  },
  {
    method: 'GET',
    path: '/api/workspaces/:workspaceId/layouts/:layoutId/history',
    auth: 'workspace',
    capability: 'read',
    handle: async (ctx) => {
      const layout = await requireLayout(ctx.workspaceId, ctx.params['layoutId']);
      return {
        status: 200,
        body: { history: await historyOf(layout.id, ctx.query.get('object_id')) },
      };
    },
  },
];

export { requireLayout };
