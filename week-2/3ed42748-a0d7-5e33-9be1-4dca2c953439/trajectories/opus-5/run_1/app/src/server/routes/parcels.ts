import { withTransaction } from '../db/pool.js';
import { newDeliveryId } from '../db/ids.js';
import { fail, validation } from '../http/errors.js';
import {
  bindRushParcel,
  boardDayNow,
  ensureBoardPosted,
  holdEndFor,
  lockRushParcel,
  markRushDelivered,
  releaseRushParcel,
} from '../domain/board.js';
import { writeMovement } from '../domain/ledger.js';
import { loadMissionIn, loadMissionVersion, promoteDueMissions } from '../domain/missions.js';
import { recordPurchase, refuseUnbuyable } from '../domain/outfitter.js';
import {
  checkOpenParcel,
  closeAcceptance,
  createAcceptance,
  holdHasLapsed,
  loadAcceptanceIn,
  refuseIfTooFar,
} from '../domain/parcels.js';
import { readPosition } from '../domain/requestFields.js';
import { readTicket, withTicket } from '../domain/tickets.js';
import type { AppRoute } from '../http/app.js';
import { actorOf, published, rawJson } from './shared.js';

function positionFingerprint(acceptanceId: unknown, position: unknown): string {
  return JSON.stringify({ acceptance_id: acceptanceId ?? null, position: position ?? null });
}

export const parcelRoutes: AppRoute[] = [
  {
    method: 'POST',
    pattern: '/api/missions/:mission_id/accept',
    auth: 'session',
    bodyKind: 'json',
    handler: async (context) => {
      const actor = actorOf(context);
      await promoteDueMissions();
      return withTransaction(async (tx) => {
        const mission = await loadMissionIn(tx, context.params.mission_id!);
        if (mission === null) throw fail('not_found');

        const repeat = await checkOpenParcel(
          tx,
          actor.courier.courier_id,
          { missionId: mission.mission_id },
          context.now,
        );
        if (repeat !== null) return { status: 200, json: repeat };

        if (mission.status !== 'live') throw fail('mission_not_live');
        if (mission.kind === 'rush') throw fail('rush_claim_required');

        const body = published(context, { position: { lat: true, lon: true } });
        const position = readPosition(body);
        const parcel = await createAcceptance(tx, {
          courierId: actor.courier.courier_id,
          mission,
          version: mission.version,
          rushId: null,
          holdExpiresAt: null,
          from: position,
          now: context.now,
        });
        return { status: 201, json: parcel };
      });
    },
  },
  {
    method: 'POST',
    pattern: '/api/rush/:rush_id/claim',
    auth: 'courier',
    bodyKind: 'json',
    handler: async (context) => {
      const actor = actorOf(context);
      await promoteDueMissions();
      const day = await boardDayNow(context.now);
      await ensureBoardPosted(day);
      return withTransaction(async (tx) => {
        const parcelRow = await lockRushParcel(tx, context.params.rush_id!);
        if (parcelRow === null) throw fail('not_found');

        const repeat = await checkOpenParcel(
          tx,
          actor.courier.courier_id,
          { rushId: parcelRow.rush_id },
          context.now,
        );
        if (repeat !== null) return { status: 200, json: repeat };

        if (parcelRow.board_date !== day.board_date) throw fail('board_closed');
        const mission = await loadMissionIn(tx, parcelRow.mission_id);
        if (mission === null || mission.status !== 'live') throw fail('mission_not_live');

        if (parcelRow.status === 'delivered') throw fail('parcel_taken');
        if (parcelRow.status === 'claimed') {
          const held = await loadAcceptanceIn(tx, parcelRow.acceptance_id!);
          if (held === null || !holdHasLapsed(held, context.now)) throw fail('parcel_taken');
          await closeAcceptance(tx, held.acceptance_id, 'expired');
        }

        const body = published(context, { position: { lat: true, lon: true } });
        const position = readPosition(body);
        const parcel = await createAcceptance(tx, {
          courierId: actor.courier.courier_id,
          mission,
          version: mission.version,
          rushId: parcelRow.rush_id,
          holdExpiresAt: holdEndFor(context.now),
          from: position,
          now: context.now,
        });
        await bindRushParcel(tx, parcelRow.rush_id, parcel.acceptance_id);
        return { status: 201, json: parcel };
      });
    },
  },
  {
    method: 'POST',
    pattern: '/api/acceptances/:acceptance_id/drop',
    auth: 'session',
    bodyKind: 'json',
    handler: async (context) => {
      const actor = actorOf(context);
      return withTransaction(async (tx) => {
        const row = await loadAcceptanceIn(tx, context.params.acceptance_id!);
        if (row === null || row.courier_id !== actor.courier.courier_id) throw fail('not_found');
        published(context, {});
        if (row.status !== 'open' || holdHasLapsed(row, context.now)) throw fail('parcel_closed');
        await closeAcceptance(tx, row.acceptance_id, 'dropped');
        if (row.rush_id !== null) await releaseRushParcel(tx, row.rush_id);
        return { status: 200, json: { acceptance_id: row.acceptance_id, status: 'dropped' } };
      });
    },
  },
  {
    method: 'POST',
    pattern: '/api/deliveries',
    auth: 'session',
    bodyKind: 'json',
    handler: async (context) => {
      const actor = actorOf(context);
      const ticket = readTicket(context.request, 'handover');
      const raw = rawJson(context);
      const acceptanceId = raw.acceptance_id;

      return withTransaction(async (tx) => {
        const stored = await withTicket(
          tx,
          actor.courier.courier_id,
          'handover',
          ticket,
          positionFingerprint(acceptanceId, raw.position),
          async () => {
            if (acceptanceId === undefined) throw validation({ acceptance_id: 'required' });
            if (typeof acceptanceId !== 'string') throw validation({ acceptance_id: 'invalid' });
            const row = await loadAcceptanceIn(tx, acceptanceId);
            if (row === null || row.courier_id !== actor.courier.courier_id) throw fail('not_found');
            if (row.status === 'delivered') throw fail('already_delivered');
            if (row.status === 'dropped') throw fail('parcel_dropped');
            if (row.status === 'expired' || holdHasLapsed(row, context.now)) {
              throw fail('hold_expired');
            }

            const body = published(context, {
              acceptance_id: true,
              position: { lat: true, lon: true },
            });
            const position = readPosition(body);
            refuseIfTooFar(row, position);

            const version = await loadMissionVersion(tx, row.mission_id, row.version);
            await tx.lock(`stamps:${actor.courier.courier_id}`);
            const movementId = await writeMovement(
              tx,
              actor.courier.courier_id,
              'delivery',
              row.mission_id,
              version.reward_stamps,
              context.now,
            );
            await closeAcceptance(tx, row.acceptance_id, 'delivered');
            if (row.rush_id !== null) await markRushDelivered(tx, row.rush_id);
            const deliveryId = newDeliveryId();
            await tx.query(
              `insert into deliveries (delivery_id, acceptance_id, courier_id, mission_id, version,
                                       stamps_awarded, movement_id, created_at)
               values ($1, $2, $3, $4, $5, $6, $7, $8)`,
              [
                deliveryId,
                row.acceptance_id,
                actor.courier.courier_id,
                row.mission_id,
                row.version,
                version.reward_stamps,
                movementId,
                context.now,
              ],
            );
            const balance = await tx.one<{ balance: number }>(
              `select coalesce(sum(e.amount), 0)::int as balance
               from ledger_entries e join movements m on m.movement_id = e.movement_id
               where m.courier_id = $1 and e.account = 'courier'`,
              [actor.courier.courier_id],
            );
            return {
              status: 201,
              body: {
                delivery_id: deliveryId,
                acceptance_id: row.acceptance_id,
                mission_id: row.mission_id,
                version: row.version,
                stamps_awarded: version.reward_stamps,
                balance: balance!.balance,
                movement_id: movementId,
                dialogue: { thanks: version.dialogue.thanks },
              },
            };
          },
        );
        return { status: stored.status, json: stored.body };
      });
    },
  },
  {
    method: 'POST',
    pattern: '/api/outfitter/:satchel_id/buy',
    auth: 'session',
    bodyKind: 'json',
    handler: async (context) => {
      const actor = actorOf(context);
      const ticket = readTicket(context.request, 'purchase');
      const satchelId = context.params.satchel_id!;
      return withTransaction(async (tx) => {
        const stored = await withTicket(
          tx,
          actor.courier.courier_id,
          'purchase',
          ticket,
          satchelId,
          async () => {
            const priced = await refuseUnbuyable(tx, actor.courier.courier_id, satchelId);
            published(context, {});
            return {
              status: 201,
              body: await recordPurchase(
                tx,
                actor.courier.courier_id,
                satchelId,
                priced,
                context.now,
              ),
            };
          },
        );
        return { status: stored.status, json: stored.body };
      });
    },
  },
];
