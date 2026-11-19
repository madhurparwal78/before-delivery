import type {
  LayoutContent,
  SessionStatus,
  SnapshotAuthority,
  SnapshotConflict,
  VersionState,
} from '../../shared/protocol.js';
import { pool, tx } from '../db/pool.js';
import { newId } from '../domain/hash.js';
import {
  buildSnapshot,
  DEFAULT_TIME_LIMIT_FAST_SECONDS,
  decideRoute,
  endAuthority,
  findRoute,
  grantAuthority,
  grantedAuthorityOf,
  initialSessionState,
  MAX_ROUTE_BLOCKS,
  MAX_TIME_LIMIT_FAST_SECONDS,
  MIN_TIME_LIMIT_FAST_SECONDS,
  moveTrainAside,
  nearestFreeLoop,
  openDeadlockFor,
  refuseAuthority,
  searchSessionBlocks,
  snapshotBlocks,
  type SessionRecord,
  type TrainRuntime,
} from '../domain/session.js';
import { errors, type ErrorExtra } from '../errors.js';
import type { Route } from '../router.js';
import {
  commitSession,
  loadSession,
  lockSession,
  markRunningClock,
} from '../services/sessionStore.js';
import { supersedeReadyPackets } from '../services/renames.js';

async function requireSession(workspaceId: string, sessionId: string): Promise<SessionRecord> {
  const record = await loadSession(sessionId, workspaceId);
  if (!record) throw errors.notFound();
  return record;
}

function trainOf(record: SessionRecord, trainId: string): TrainRuntime {
  const train = record.state.trains.find((entry) => entry.id === trainId);
  if (!train) throw errors.notFound();
  return train;
}

function blockName(record: SessionRecord, blockId: string): string {
  return record.state.content.blocks.find((block) => block.id === blockId)?.name ?? blockId;
}

function requireActive(record: SessionRecord): void {
  if (record.status !== 'Running' && record.status !== 'Held') throw errors.sessionNotActive();
}

function blockStateOf(record: SessionRecord, blockId: string): string {
  return snapshotBlocks(record.state).find((block) => block.id === blockId)?.state ?? 'free';
}

const STATUS_MOVES: Record<string, { from: SessionStatus[]; to: SessionStatus }> = {
  start: { from: ['Scheduled'], to: 'Running' },
  hold: { from: ['Running'], to: 'Held' },
  resume: { from: ['Held', 'Interrupted'], to: 'Running' },
  end: { from: ['Running', 'Held', 'Interrupted'], to: 'Ended' },
};

function statusRoute(command: 'start' | 'hold' | 'resume' | 'end'): Route {
  return {
    method: 'POST',
    path: `/api/workspaces/:workspaceId/sessions/:sessionId/${command}`,
    auth: 'workspace',
    capability: 'operate',
    handle: async (ctx) => {
      const preflight = await requireSession(ctx.workspaceId, ctx.params['sessionId']);
      return ctx.once(async () => {
        ctx.requireRevision(preflight.control_revision);
        await ctx.requireValkey();
        const move = STATUS_MOVES[command];
        return tx(async (client) => {
          const record = await lockSession(client, ctx.params['sessionId'], ctx.workspaceId);
          if (!record) throw errors.notFound();
          if (record.control_revision !== preflight.control_revision) throw errors.staleRevision();
          const resumable =
            command !== 'resume' || record.hold_reason !== 'valkey';
          if (!move.from.includes(record.status) || !resumable) {
            throw errors.sessionTransition(record.status);
          }
          record.status = move.to;
          record.hold_reason = command === 'hold' ? 'operator' : null;
          record.control_revision += 1;
          if (move.to === 'Running') await markRunningClock(client, record.id);
          await commitSession(client, record, 'session.status', {
            command,
            status: record.status,
            hold_reason: record.hold_reason,
            tick: record.tick,
          });
          return { status: 200, body: buildSnapshot(record) };
        });
      });
    },
  };
}

export const sessionRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/workspaces/:workspaceId/sessions',
    auth: 'workspace',
    capability: 'read',
    handle: async (ctx) => {
      const { rows } = await pool.query<{
        id: string;
        name: string;
        status: SessionStatus;
        tick: number;
        layout_version_number: number;
      }>(
        `select id, name, status, tick::int as tick, layout_version_number
         from sessions where workspace_id = $1 order by created_at`,
        [ctx.workspaceId],
      );
      return { status: 200, body: { sessions: rows } };
    },
  },
  {
    method: 'POST',
    path: '/api/workspaces/:workspaceId/sessions',
    auth: 'workspace',
    capability: 'operate',
    handle: async (ctx) => {
      const versionId = ctx.body['layout_version_id'];
      if (typeof versionId !== 'string') throw errors.invalidFields();
      const { rows } = await pool.query<{
        id: string;
        layout_id: string;
        number: number;
        state: VersionState;
        content: LayoutContent;
      }>(
        `select v.id, v.layout_id, v.number, v.state, v.content from layout_versions v
         join layouts l on l.id = v.layout_id
         where v.id = $1 and l.workspace_id = $2`,
        [versionId, ctx.workspaceId],
      );
      const version = rows[0];
      if (!version) throw errors.notFound();

      return ctx.once(async () => {
        const name = ctx.text('name', 120);
        const ratio = ctx.optionalWhole('ratio', 1, 12, 6);
        if (version.state !== 'Published') throw errors.versionNotPublished();
        const id = newId('ses');
        const content = JSON.parse(JSON.stringify(version.content)) as LayoutContent;
        const state = initialSessionState(content);
        await pool.query(
          `insert into sessions (id, workspace_id, layout_id, name, status, hold_reason, ratio,
               revision, control_revision, session_version, tick, layout_version_id,
               layout_version_number, timetable_version, state)
           values ($1, $2, $3, $4, 'Scheduled', null, $5, 0, 0, 1, 0, $6, $7, $8, $9)`,
          [
            id,
            ctx.workspaceId,
            version.layout_id,
            name,
            ratio,
            version.id,
            version.number,
            content.timetable.version,
            JSON.stringify(state),
          ],
        );
        const record = await loadSession(id, ctx.workspaceId);
        if (!record) throw errors.notFound();
        return { status: 201, body: buildSnapshot(record) };
      });
    },
  },
  {
    method: 'GET',
    path: '/api/workspaces/:workspaceId/sessions/:sessionId',
    auth: 'workspace',
    capability: 'read',
    handle: async (ctx) => ({
      status: 200,
      body: buildSnapshot(await requireSession(ctx.workspaceId, ctx.params['sessionId'])),
    }),
  },
  statusRoute('start'),
  statusRoute('hold'),
  statusRoute('resume'),
  statusRoute('end'),
  {
    method: 'GET',
    path: '/api/workspaces/:workspaceId/sessions/:sessionId/blocks',
    auth: 'workspace',
    capability: 'read',
    handle: async (ctx) => {
      const record = await requireSession(ctx.workspaceId, ctx.params['sessionId']);
      return {
        status: 200,
        body: {
          blocks: searchSessionBlocks(record.state, ctx.query.get('q') ?? '').map((block) => ({
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
    path: '/api/workspaces/:workspaceId/sessions/:sessionId/trains',
    auth: 'workspace',
    capability: 'operate',
    handle: async (ctx) => {
      const preflight = await requireSession(ctx.workspaceId, ctx.params['sessionId']);
      return ctx.once(async () => {
        ctx.requireRevision(preflight.session_version);
        await ctx.requireValkey();
        const number = ctx.text('number', 20);
        const name = ctx.text('name', 120);
        const lengthMm = ctx.whole('length_mm', 300, 2400);
        const speedMph = ctx.whole('speed_mph', 5, 60);
        const direction = ctx.choice('direction', ['east', 'west'] as const);
        const startBlockId = ctx.text('start_block_id', 200);

        return tx(async (client) => {
          const record = await lockSession(client, ctx.params['sessionId'], ctx.workspaceId);
          if (!record) throw errors.notFound();
          if (record.session_version !== preflight.session_version) throw errors.staleRevision();
          if (!['Scheduled', 'Running', 'Held'].includes(record.status)) {
            throw errors.sessionTransition(record.status);
          }
          const block = record.state.content.blocks.find((entry) => entry.id === startBlockId);
          if (!block) throw errors.invalidFields();
          if (record.state.trains.some((train) => train.number === number)) {
            throw errors.invalidFields();
          }
          if (blockStateOf(record, block.id) !== 'free') throw errors.blockInUse(block.name);

          const train: TrainRuntime = {
            id: newId('tr'),
            number,
            name,
            direction,
            speed_mph: speedMph,
            length_mm: lengthMm,
            head_block_id: block.id,
            head_offset_mm: block.length_mm,
            trail_block_ids: [block.id],
            distance_run_mm: 0,
            carry: 0,
            revision: 0,
            start_block_id: block.id,
            start_head_offset_mm: block.length_mm,
          };
          record.state.trains.push(train);
          record.state.content.trains.push({
            id: train.id,
            number,
            name,
            direction,
            speed_mph: speedMph,
            length_mm: lengthMm,
            start_block_id: block.id,
            start_head_offset_mm: block.length_mm,
          });
          record.session_version += 1;
          await commitSession(client, record, 'session.version', {
            train_id: train.id,
            train_number: number,
            session_version: record.session_version,
          });
          await supersedeReadyPackets(client, record);
          return { status: 201, body: buildSnapshot(record) };
        });
      });
    },
  },
  {
    method: 'POST',
    path: '/api/workspaces/:workspaceId/sessions/:sessionId/trains/:trainId/route-preview',
    auth: 'workspace',
    capability: 'operate',
    handle: async (ctx) => {
      const record = await requireSession(ctx.workspaceId, ctx.params['sessionId']);
      const train = trainOf(record, ctx.params['trainId']);
      const destinationId = ctx.text('destination_block_id', 200);
      const viaId = ctx.optionalId('via_block_id');
      const destination = record.state.content.blocks.find((block) => block.id === destinationId);
      if (!destination) throw errors.invalidFields();

      const route = findRoute(
        record.state.content,
        train.head_block_id,
        train.direction,
        destinationId,
        viaId,
      );
      if (!route || route.length === 0) throw errors.noRoute(destination.name);
      if (route.length > MAX_ROUTE_BLOCKS) throw errors.routeTooLong();
      const decision = decideRoute(record.state, train, route);
      return {
        status: 200,
        body: {
          route_block_ids: route,
          limit_block_id: route[route.length - 1],
          clear: decision.conflictBlockId === null,
          conflict_block_id: decision.conflictBlockId,
          other_train_number: decision.otherTrainNumber,
        },
      };
    },
  },
  {
    method: 'POST',
    path: '/api/workspaces/:workspaceId/sessions/:sessionId/trains/:trainId/authorities',
    auth: 'workspace',
    capability: 'operate',
    handle: async (ctx) => {
      const preflight = await requireSession(ctx.workspaceId, ctx.params['sessionId']);
      const preTrain = trainOf(preflight, ctx.params['trainId']);
      const result = await ctx.once(async () => {
        ctx.requireRevision(preTrain.revision);
        await ctx.requireValkey();
        const destinationId = ctx.text('destination_block_id', 200);
        const viaId = ctx.optionalId('via_block_id');
        const timeLimit = ctx.optionalWhole(
          'time_limit_fast_seconds',
          MIN_TIME_LIMIT_FAST_SECONDS,
          MAX_TIME_LIMIT_FAST_SECONDS,
          DEFAULT_TIME_LIMIT_FAST_SECONDS,
        );

        return tx(async (client) => {
          const record = await lockSession(client, ctx.params['sessionId'], ctx.workspaceId);
          if (!record) throw errors.notFound();
          const train = trainOf(record, ctx.params['trainId']);
          if (train.revision !== preTrain.revision) throw errors.staleRevision();
          requireActive(record);

          const deadlock = openDeadlockFor(record.state, train.id);
          if (deadlock) throw errors.deadlockOpen(deadlock.train_numbers);
          if (grantedAuthorityOf(record.state, train.id)) throw errors.authorityActive(train.number);

          const destination = record.state.content.blocks.find(
            (block) => block.id === destinationId,
          );
          if (!destination) throw errors.invalidFields();

          const route = findRoute(
            record.state.content,
            train.head_block_id,
            train.direction,
            destinationId,
            viaId,
          );
          if (!route || route.length === 0) throw errors.noRoute(destination.name);
          if (route.length > MAX_ROUTE_BLOCKS) throw errors.routeTooLong();

          const decision = decideRoute(record.state, train, route);
          if (decision.conflictBlockId !== null) {
            const refusal = refuseAuthority(record.state, train, decision);
            await commitSession(client, record, 'authority.refused', {
              authority: refusal.authority,
              conflict: refusal.conflict,
              train_number: train.number,
              block_name: blockName(record, decision.conflictBlockId),
              other_train_number: decision.otherTrainNumber,
            });
            return {
              status: 422,
              body: {
                refused: true,
                other_train_number: decision.otherTrainNumber,
                block_name: blockName(record, decision.conflictBlockId),
                authority: refusal.authority,
                conflict: refusal.conflict,
                reachable_block_ids: decision.reachableBlockIds,
              },
            };
          }

          const authority = grantAuthority(
            record.state,
            train,
            route,
            record.tick * record.ratio,
            timeLimit,
          );
          await commitSession(client, record, 'authority.granted', {
            authority,
            train_number: train.number,
            destination_name: destination.name,
            block_count: route.length,
          });
          return {
            status: 201,
            body: { authority, session: buildSnapshot(record) },
          };
        });
      });

      if (result.status === 422) {
        const body = result.body as {
          other_train_number: string | null;
          block_name: string;
          authority: unknown;
          conflict: unknown;
          reachable_block_ids: string[];
        };
        const extra: ErrorExtra = {
          authority: body.authority as SnapshotAuthority,
          conflict: body.conflict as SnapshotConflict,
          reachable_block_ids: body.reachable_block_ids,
        };
        throw body.other_train_number
          ? errors.routeConflictHeld(body.other_train_number, body.block_name, extra)
          : errors.routeConflictOutOfService(body.block_name, extra);
      }
      return result;
    },
  },
  {
    method: 'POST',
    path: '/api/workspaces/:workspaceId/sessions/:sessionId/authorities/:authorityId/cancel',
    auth: 'workspace',
    capability: 'operate',
    handle: async (ctx) => {
      const preflight = await requireSession(ctx.workspaceId, ctx.params['sessionId']);
      const preAuthority = preflight.state.authorities.find(
        (entry) => entry.id === ctx.params['authorityId'],
      );
      if (!preAuthority) throw errors.notFound();
      return ctx.once(async () => {
        ctx.requireRevision(preAuthority.revision);
        await ctx.requireValkey();
        return tx(async (client) => {
          const record = await lockSession(client, ctx.params['sessionId'], ctx.workspaceId);
          if (!record) throw errors.notFound();
          const authority = record.state.authorities.find(
            (entry) => entry.id === ctx.params['authorityId'],
          );
          if (!authority) throw errors.notFound();
          if (authority.revision !== preAuthority.revision) throw errors.staleRevision();
          requireActive(record);
          if (authority.state !== 'Granted') throw errors.authorityEnded();
          const train = trainOf(record, authority.train_id);
          const headBlock = record.state.content.blocks.find(
            (block) => block.id === train.head_block_id,
          );
          if (headBlock?.kind === 'approach') throw errors.approachLocked(train.number);

          endAuthority(record.state, authority, 'Released', 'cancelled');
          train.revision += 1;
          await commitSession(client, record, 'authority.released', {
            authority,
            train_number: train.number,
            ended_reason: 'cancelled',
          });
          return {
            status: 200,
            body: { authority, session: buildSnapshot(record) },
          };
        });
      });
    },
  },
  {
    method: 'POST',
    path: '/api/workspaces/:workspaceId/sessions/:sessionId/trains/:trainId/back-to-loop',
    auth: 'workspace',
    capability: 'operate',
    handle: async (ctx) => {
      const preflight = await requireSession(ctx.workspaceId, ctx.params['sessionId']);
      const preTrain = trainOf(preflight, ctx.params['trainId']);
      return ctx.once(async () => {
        ctx.requireRevision(preTrain.revision);
        await ctx.requireValkey();
        return tx(async (client) => {
          const record = await lockSession(client, ctx.params['sessionId'], ctx.workspaceId);
          if (!record) throw errors.notFound();
          const train = trainOf(record, ctx.params['trainId']);
          if (train.revision !== preTrain.revision) throw errors.staleRevision();
          requireActive(record);
          const loop = nearestFreeLoop(record.state, train);
          if (!loop) throw errors.noFreeLoop(train.number);
          moveTrainAside(record.state, train, loop.id, loop.length_mm);
          await commitSession(client, record, 'train.moved', {
            train_id: train.id,
            train_number: train.number,
            command: 'back-to-loop',
            block_id: loop.id,
            block_name: loop.name,
          });
          return { status: 200, body: buildSnapshot(record) };
        });
      });
    },
  },
  {
    method: 'POST',
    path: '/api/workspaces/:workspaceId/sessions/:sessionId/trains/:trainId/recall',
    auth: 'workspace',
    capability: 'operate',
    handle: async (ctx) => {
      const preflight = await requireSession(ctx.workspaceId, ctx.params['sessionId']);
      const preTrain = trainOf(preflight, ctx.params['trainId']);
      return ctx.once(async () => {
        ctx.requireRevision(preTrain.revision);
        await ctx.requireValkey();
        return tx(async (client) => {
          const record = await lockSession(client, ctx.params['sessionId'], ctx.workspaceId);
          if (!record) throw errors.notFound();
          const train = trainOf(record, ctx.params['trainId']);
          if (train.revision !== preTrain.revision) throw errors.staleRevision();
          requireActive(record);
          const start = record.state.content.blocks.find(
            (block) => block.id === train.start_block_id,
          );
          if (!start) throw errors.notFound();
          const occupiedByItself = train.head_block_id === start.id;
          if (!occupiedByItself && blockStateOf(record, start.id) !== 'free') {
            throw errors.recallBlocked(start.name);
          }
          moveTrainAside(record.state, train, start.id, train.start_head_offset_mm);
          await commitSession(client, record, 'train.moved', {
            train_id: train.id,
            train_number: train.number,
            command: 'recall',
            block_id: start.id,
            block_name: start.name,
          });
          return { status: 200, body: buildSnapshot(record) };
        });
      });
    },
  },
  {
    method: 'PATCH',
    path: '/api/workspaces/:workspaceId/sessions/:sessionId/conflicts/:conflictId',
    auth: 'workspace',
    capability: 'operate',
    handle: async (ctx) => {
      const preflight = await requireSession(ctx.workspaceId, ctx.params['sessionId']);
      const preConflict = preflight.state.conflicts.find(
        (entry) => entry.id === ctx.params['conflictId'],
      );
      if (!preConflict) throw errors.notFound();
      return ctx.once(async () => {
        ctx.requireRevision(preConflict.revision);
        await ctx.requireValkey();
        const note = ctx.optionalText('note', 2000);
        return tx(async (client) => {
          const record = await lockSession(client, ctx.params['sessionId'], ctx.workspaceId);
          if (!record) throw errors.notFound();
          const conflict = record.state.conflicts.find(
            (entry) => entry.id === ctx.params['conflictId'],
          );
          if (!conflict) throw errors.notFound();
          if (conflict.revision !== preConflict.revision) throw errors.staleRevision();
          conflict.note = note;
          conflict.revision += 1;
          await commitSession(client, record, 'conflict.changed', {
            conflict_id: conflict.id,
            note,
          });
          return { status: 200, body: { conflict } };
        });
      });
    },
  },
  {
    method: 'POST',
    path: '/api/workspaces/:workspaceId/sessions/:sessionId/conflicts/:conflictId/withdraw',
    auth: 'workspace',
    capability: 'operate',
    handle: async (ctx) => {
      const preflight = await requireSession(ctx.workspaceId, ctx.params['sessionId']);
      const preConflict = preflight.state.conflicts.find(
        (entry) => entry.id === ctx.params['conflictId'],
      );
      if (!preConflict) throw errors.notFound();
      return ctx.once(async () => {
        ctx.requireRevision(preConflict.revision);
        await ctx.requireValkey();
        return tx(async (client) => {
          const record = await lockSession(client, ctx.params['sessionId'], ctx.workspaceId);
          if (!record) throw errors.notFound();
          const conflict = record.state.conflicts.find(
            (entry) => entry.id === ctx.params['conflictId'],
          );
          if (!conflict) throw errors.notFound();
          if (conflict.revision !== preConflict.revision) throw errors.staleRevision();
          const deadlock = openDeadlockFor(record.state, conflict.train_id);
          if (deadlock) throw errors.deadlockOpen(deadlock.train_numbers);
          conflict.state = 'Closed';
          conflict.revision += 1;
          await commitSession(client, record, 'conflict.closed', {
            conflict_id: conflict.id,
            reason: 'withdrawn',
          });
          return { status: 200, body: buildSnapshot(record) };
        });
      });
    },
  },
  {
    method: 'POST',
    path: '/api/workspaces/:workspaceId/sessions/:sessionId/blocks/:blockId/service',
    auth: 'workspace',
    capability: 'operate',
    handle: async (ctx) => {
      const preflight = await requireSession(ctx.workspaceId, ctx.params['sessionId']);
      if (!preflight.state.content.blocks.some((block) => block.id === ctx.params['blockId'])) {
        throw errors.notFound();
      }
      return ctx.once(async () => {
        ctx.requireRevision(preflight.control_revision);
        await ctx.requireValkey();
        const outOfService = ctx.flag('out_of_service');
        return tx(async (client) => {
          const record = await lockSession(client, ctx.params['sessionId'], ctx.workspaceId);
          if (!record) throw errors.notFound();
          if (record.control_revision !== preflight.control_revision) throw errors.staleRevision();
          requireActive(record);
          const block = record.state.content.blocks.find(
            (entry) => entry.id === ctx.params['blockId'],
          );
          if (!block) throw errors.notFound();
          const list = record.state.out_of_service_block_ids;
          if (outOfService) {
            if (blockStateOf(record, block.id) !== 'free') throw errors.blockInUse(block.name);
            if (!list.includes(block.id)) list.push(block.id);
          } else {
            const index = list.indexOf(block.id);
            if (index >= 0) list.splice(index, 1);
          }
          record.control_revision += 1;
          await commitSession(client, record, 'block.changed', {
            block_id: block.id,
            block_name: block.name,
            out_of_service: outOfService,
          });
          return { status: 200, body: buildSnapshot(record) };
        });
      });
    },
  },
  {
    method: 'POST',
    path: '/api/workspaces/:workspaceId/sessions/:sessionId/turnouts/:turnoutId/throw',
    auth: 'workspace',
    capability: 'operate',
    handle: async (ctx) => {
      const preflight = await requireSession(ctx.workspaceId, ctx.params['sessionId']);
      if (!preflight.state.turnouts.some((entry) => entry.id === ctx.params['turnoutId'])) {
        throw errors.notFound();
      }
      return ctx.once(async () => {
        ctx.requireRevision(preflight.control_revision);
        await ctx.requireValkey();
        const position = ctx.choice('position', ['normal', 'reverse'] as const);
        return tx(async (client) => {
          const record = await lockSession(client, ctx.params['sessionId'], ctx.workspaceId);
          if (!record) throw errors.notFound();
          if (record.control_revision !== preflight.control_revision) throw errors.staleRevision();
          requireActive(record);
          const turnout = record.state.turnouts.find(
            (entry) => entry.id === ctx.params['turnoutId'],
          );
          if (!turnout) throw errors.notFound();
          if (turnout.locked_by_authority_id) {
            const authority = record.state.authorities.find(
              (entry) => entry.id === turnout.locked_by_authority_id,
            );
            const train = record.state.trains.find((entry) => entry.id === authority?.train_id);
            throw errors.turnoutLocked(turnout.id, train?.number ?? '');
          }
          turnout.position = position;
          record.control_revision += 1;
          await commitSession(client, record, 'turnout.changed', {
            turnout_id: turnout.id,
            position,
          });
          return { status: 200, body: buildSnapshot(record) };
        });
      });
    },
  },
];

export { requireSession };
