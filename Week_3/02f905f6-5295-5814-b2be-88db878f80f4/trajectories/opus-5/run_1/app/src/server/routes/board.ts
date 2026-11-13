import type { PoolClient } from 'pg';
import type { PlacementResult, Rotation } from '../../shared/types';
import { signedInUser, type Ctx, type Route } from '../http/router';
import * as errors from '../http/errors';
import { withTransaction } from '../db/pool';
import {
  judgePlacement,
  parseCoordinate,
  parseRotation,
  PLACEMENT_FIELD_MSG,
} from '../../shared/placement';
import { halfUnitsToInches } from '../domain/measure';
import { findKiln, findProfile, listKilns, type KilnRecord } from '../repo/catalog';
import {
  deletePlacement,
  fillOf,
  findFiring,
  footprintsOnLayer,
  insertPlacement,
  layerHeightOf,
  lockFiring,
  movePlacement,
  placementsOf,
  placementsOfLocked,
  createFiring,
  startFiring,
  statusOf,
  toFiring,
  type FiringRow,
} from '../repo/firings';
import { addHistory, loadPieces } from '../repo/pieces';
import { runUnload } from '../flows/unload';

interface PieceForPlacement {
  number: string;
  shape: 'round' | 'rectangular' | 'plate';
  width_half: number;
  depth_half: number;
  height_half: number;
  stage: 'bisque' | 'glaze' | null;
  cone: '06' | '6' | null;
  status: string;
  max_cone: '06' | '04' | '02' | '6' | '10';
}

async function firingAndKiln(ctx: Ctx): Promise<{ firing: FiringRow; kiln: KilnRecord }> {
  const firing = await findFiring(ctx.params.id);
  if (!firing) throw errors.notFound();
  const kiln = await findKiln(firing.kiln_id);
  if (!kiln) throw errors.notFound();
  return { firing, kiln };
}

async function pieceForPlacement(
  client: PoolClient,
  number: string,
): Promise<PieceForPlacement | null> {
  const result = await client.query<PieceForPlacement>(
    `select p.number, p.shape, p.width_half, p.depth_half, p.height_half, p.stage, p.cone,
            p.status, c.max_cone
     from pieces p join clays c on c.id = p.clay_id
     where p.number = $1 for update of p`,
    [number],
  );
  return result.rows[0] ?? null;
}

interface PlacementSpot {
  layer: number;
  xHalf: number;
  yHalf: number;
  rotation: Rotation;
}

function readSpot(
  body: Record<string, unknown>,
  kiln: KilnRecord,
  current: PlacementSpot | null,
): PlacementSpot {
  const fields: Record<string, string> = {};
  const layerRaw = body.layer ?? current?.layer;
  const layer = typeof layerRaw === 'string' ? Number(layerRaw) : layerRaw;
  if (!Number.isInteger(layer) || (layer as number) < 1 || (layer as number) > kiln.layers) {
    fields.layer = PLACEMENT_FIELD_MSG.layer;
  }
  const xHalf =
    body.x === undefined && current ? current.xHalf : parseCoordinate(body.x);
  if (xHalf === null) fields.x = PLACEMENT_FIELD_MSG.coordinate;
  const yHalf =
    body.y === undefined && current ? current.yHalf : parseCoordinate(body.y);
  if (yHalf === null) fields.y = PLACEMENT_FIELD_MSG.coordinate;
  const rotation =
    body.rotation === undefined && current ? current.rotation : parseRotation(body.rotation);
  if (rotation === null) fields.rotation = PLACEMENT_FIELD_MSG.rotation;
  if (Object.keys(fields).length > 0) throw errors.unprocessable(fields);
  return {
    layer: layer as number,
    xHalf: xHalf as number,
    yHalf: yHalf as number,
    rotation: rotation as Rotation,
  };
}

async function placementReply(
  client: PoolClient,
  firing: FiringRow,
  kiln: KilnRecord,
  pieceNumber: string,
  spot: PlacementSpot,
): Promise<PlacementResult> {
  const placements = await placementsOfLocked(client, firing.id);
  return {
    placement: {
      piece_number: pieceNumber,
      firing_id: firing.id,
      layer: spot.layer,
      x: halfUnitsToInches(spot.xHalf),
      y: halfUnitsToInches(spot.yHalf),
      rotation: spot.rotation,
    },
    fill_percent: fillOf(placements, kiln),
    layer_height_in: layerHeightOf(placements, spot.layer),
  };
}

export const boardRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/kilns',
    roles: ['tech', 'owner'],
    handler: async () => {
      const kilns = await listKilns();
      return {
        status: 200,
        body: kilns.map(({ postHeightHalfUnits, ...kiln }) => kiln),
      };
    },
  },
  {
    method: 'GET',
    path: '/api/queue',
    roles: ['tech', 'owner'],
    handler: async () => ({ status: 200, body: await loadPieces({ status: 'queued' }) }),
  },
  {
    method: 'POST',
    path: '/api/firings',
    roles: ['tech', 'owner'],
    handler: async (ctx) => {
      const kiln = await findKiln(ctx.body.kiln_id);
      if (!kiln) throw errors.unprocessable({ kiln_id: 'Choose a kiln' });
      const profile = await findProfile(kiln.id, ctx.body.profile_id);
      if (!profile) throw errors.unprocessable({ profile_id: 'Choose a profile on this kiln' });
      const created = await createFiring(kiln.id, profile);
      if (created === 'kiln_busy') {
        throw errors.conflict('kiln_busy', 'This kiln already has a firing in progress.');
      }
      return { status: 201, body: toFiring(created, kiln, [], ctx.now) };
    },
  },
  {
    method: 'GET',
    path: '/api/firings/:id',
    roles: ['tech', 'owner'],
    handler: async (ctx) => {
      const { firing, kiln } = await firingAndKiln(ctx);
      return {
        status: 200,
        body: toFiring(firing, kiln, await placementsOf(firing.id), ctx.now),
      };
    },
  },
  {
    method: 'POST',
    path: '/api/firings/:id/placements',
    roles: ['tech', 'owner'],
    handler: async (ctx) => {
      const user = signedInUser(ctx);
      const { firing, kiln } = await firingAndKiln(ctx);
      if (statusOf(firing, ctx.now) !== 'building') {
        throw errors.conflict('firing_locked', 'This load has already been started.');
      }
      const pieceNumber =
        typeof ctx.body.piece_number === 'string' ? ctx.body.piece_number : null;
      if (!pieceNumber) throw errors.unprocessable({ piece_number: PLACEMENT_FIELD_MSG.piece_number });
      const spot = readSpot(ctx.body, kiln, null);

      const reply = await withTransaction(async (client) => {
        const locked = await lockFiring(client, firing.id);
        if (!locked) throw errors.notFound();
        if (statusOf(locked, ctx.now) !== 'building') {
          throw errors.conflict('firing_locked', 'This load has already been started.');
        }
        const piece = await pieceForPlacement(client, pieceNumber);
        if (!piece) {
          throw errors.unprocessable({ piece_number: PLACEMENT_FIELD_MSG.piece_number });
        }
        if (piece.status !== 'queued') {
          throw errors.conflict('piece_not_queued', `Piece ${pieceNumber} was placed elsewhere.`);
        }
        const placements = await placementsOfLocked(client, firing.id);
        const refusal = judgePlacement(
          {
            sides: { shape: piece.shape, width: piece.width_half, depth: piece.depth_half },
            height: piece.height_half,
            stage: piece.stage,
            clayMaxCone: piece.max_cone,
            glazeCone: piece.cone,
            x: spot.xHalf,
            y: spot.yHalf,
            rotation: spot.rotation,
          },
          {
            firingStage: locked.profile.stage,
            firingCone: locked.profile.cone,
            postHeight: kiln.postHeightHalfUnits,
            occupied: footprintsOnLayer(placements, spot.layer),
          },
        );
        if (refusal) throw errors.placementRefused(refusal.reason, refusal.message);
        await insertPlacement(client, {
          firingId: firing.id,
          pieceNumber,
          layer: spot.layer,
          xHalf: spot.xHalf,
          yHalf: spot.yHalf,
          rotation: spot.rotation,
        });
        await addHistory(client, pieceNumber, user.name, 'placed');
        return placementReply(client, locked, kiln, pieceNumber, spot);
      });
      return { status: 201, body: reply };
    },
  },
  {
    method: 'PATCH',
    path: '/api/firings/:id/placements/:piece_number',
    roles: ['tech', 'owner'],
    handler: async (ctx) => {
      const user = signedInUser(ctx);
      const { firing, kiln } = await firingAndKiln(ctx);
      const pieceNumber = ctx.params.piece_number as string;
      if (statusOf(firing, ctx.now) !== 'building') {
        throw errors.conflict('firing_locked', 'This load has already been started.');
      }

      const reply = await withTransaction(async (client) => {
        const locked = await lockFiring(client, firing.id);
        if (!locked) throw errors.notFound();
        if (statusOf(locked, ctx.now) !== 'building') {
          throw errors.conflict('firing_locked', 'This load has already been started.');
        }
        const placements = await placementsOfLocked(client, firing.id);
        const existing = placements.find((row) => row.piece_number === pieceNumber);
        if (!existing) throw errors.notFound();
        const piece = await pieceForPlacement(client, pieceNumber);
        if (!piece) throw errors.notFound();
        const spot = readSpot(ctx.body, kiln, {
          layer: existing.layer,
          xHalf: existing.x_half,
          yHalf: existing.y_half,
          rotation: existing.rotation,
        });
        const refusal = judgePlacement(
          {
            sides: { shape: piece.shape, width: piece.width_half, depth: piece.depth_half },
            height: piece.height_half,
            stage: piece.stage,
            clayMaxCone: piece.max_cone,
            glazeCone: piece.cone,
            x: spot.xHalf,
            y: spot.yHalf,
            rotation: spot.rotation,
          },
          {
            firingStage: locked.profile.stage,
            firingCone: locked.profile.cone,
            postHeight: kiln.postHeightHalfUnits,
            occupied: footprintsOnLayer(placements, spot.layer, pieceNumber),
          },
        );
        if (refusal) throw errors.placementRefused(refusal.reason, refusal.message);
        await movePlacement(client, {
          firingId: firing.id,
          pieceNumber,
          layer: spot.layer,
          xHalf: spot.xHalf,
          yHalf: spot.yHalf,
          rotation: spot.rotation,
        });
        await addHistory(client, pieceNumber, user.name, 'moved');
        return placementReply(client, locked, kiln, pieceNumber, spot);
      });
      return { status: 200, body: reply };
    },
  },
  {
    method: 'DELETE',
    path: '/api/firings/:id/placements/:piece_number',
    roles: ['tech', 'owner'],
    handler: async (ctx) => {
      const user = signedInUser(ctx);
      const { firing, kiln } = await firingAndKiln(ctx);
      const pieceNumber = ctx.params.piece_number as string;
      if (statusOf(firing, ctx.now) !== 'building') {
        throw errors.conflict('firing_locked', 'This load has already been started.');
      }
      const fill = await withTransaction(async (client) => {
        const locked = await lockFiring(client, firing.id);
        if (!locked) throw errors.notFound();
        if (statusOf(locked, ctx.now) !== 'building') {
          throw errors.conflict('firing_locked', 'This load has already been started.');
        }
        if (!(await deletePlacement(client, firing.id, pieceNumber))) throw errors.notFound();
        await addHistory(client, pieceNumber, user.name, 'removed');
        return fillOf(await placementsOfLocked(client, firing.id), kiln);
      });
      return { status: 200, body: { fill_percent: fill } };
    },
  },
  {
    method: 'POST',
    path: '/api/firings/:id/start',
    roles: ['tech', 'owner'],
    handler: async (ctx) => {
      const user = signedInUser(ctx);
      const { firing, kiln } = await firingAndKiln(ctx);
      if (statusOf(firing, ctx.now) !== 'building') {
        throw errors.conflict('invalid_transition', 'This firing has already been started.');
      }
      const started = await withTransaction(async (client) => {
        const locked = await lockFiring(client, firing.id);
        if (!locked) throw errors.notFound();
        if (statusOf(locked, ctx.now) !== 'building') {
          throw errors.conflict('invalid_transition', 'This firing has already been started.');
        }
        const placements = await placementsOfLocked(client, firing.id);
        if (placements.length === 0) {
          throw errors.conflict('empty_load', 'Place at least one piece before starting.');
        }
        const profile = await findProfile(locked.kiln_id, locked.profile.id);
        const row = await startFiring(client, locked, profile ?? locked.profile, ctx.now);
        if (!row) throw errors.conflict('invalid_transition', 'This firing has already been started.');
        for (const placement of placements) {
          await addHistory(client, placement.piece_number, user.name, 'fired');
        }
        return toFiring(row, kiln, placements, ctx.now);
      });
      return { status: 200, body: started };
    },
  },
  {
    method: 'POST',
    path: '/api/firings/:id/unload',
    roles: ['tech', 'owner'],
    handler: async (ctx) => {
      const user = signedInUser(ctx);
      const { firing, kiln } = await firingAndKiln(ctx);
      const unloaded = await runUnload({
        firing,
        kiln,
        body: ctx.body,
        actor: user,
        now: ctx.now,
      });
      return { status: 200, body: unloaded };
    },
  },
];
