import type { PieceStatus, TrackingView } from '../../shared/types';
import { PIECE_STATUS_LABELS } from '../../shared/labels';
import { isStaff, signedInUser, type Route } from '../http/router';
import * as errors from '../http/errors';
import { withTransaction } from '../db/pool';
import { canCollect } from '../domain/pieceStatus';
import {
  addHistory,
  createTrackingLink,
  findPieceJoined,
  loadPiece,
  loadPieces,
  markCollected,
  pieceForToken,
  pieceStatusOf,
  revokeTrackingLinks,
  trackingUrl,
} from '../repo/pieces';
import { queueMessage } from '../repo/outbox';
import { newTrackingLink } from '../services/messages';

const DEAD_LINK = 'This tracking link is no longer active.';

const STATUSES: PieceStatus[] = [
  'awaiting_payment',
  'queued',
  'loaded',
  'firing',
  'cooling',
  'unloadable',
  'ready',
  'collected',
  'uncollected',
];

export const pieceRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/pieces',
    roles: ['member', 'tech', 'owner'],
    handler: async (ctx) => {
      const user = signedInUser(ctx);
      const asked = ctx.req.query.status;
      const status =
        typeof asked === 'string' && (STATUSES as string[]).includes(asked)
          ? (asked as PieceStatus)
          : undefined;
      const pieces = await loadPieces(
        isStaff(user) ? { status } : { ownerUserId: user.id, status },
      );
      return { status: 200, body: pieces };
    },
  },
  {
    method: 'GET',
    path: '/api/pieces/:number',
    roles: ['member', 'tech', 'owner'],
    handler: async (ctx) => {
      const user = signedInUser(ctx);
      const row = await findPieceJoined(ctx.params.number as string);
      if (!row) throw errors.notFound();
      if (!isStaff(user) && row.owner_user_id !== user.id) throw errors.notFound();
      const piece = await loadPiece(row.number);
      if (!piece) throw errors.notFound();
      return { status: 200, body: piece };
    },
  },
  {
    method: 'POST',
    path: '/api/pieces/:number/collect',
    roles: ['tech', 'owner'],
    handler: async (ctx) => {
      const user = signedInUser(ctx);
      const number = ctx.params.number as string;
      const row = await findPieceJoined(number);
      if (!row) throw errors.notFound();
      if (!canCollect(pieceStatusOf(row, ctx.now))) {
        throw errors.conflict(
          'invalid_transition',
          `Piece ${number} is not on the pickup shelf.`,
        );
      }
      await withTransaction(async (client) => {
        if (!(await markCollected(client, number))) {
          throw errors.conflict(
            'invalid_transition',
            `Piece ${number} is not on the pickup shelf.`,
          );
        }
        await addHistory(client, number, user.name, 'collected');
        await revokeTrackingLinks(client, number);
      });
      return { status: 200, body: await loadPiece(number) };
    },
  },
  {
    method: 'POST',
    path: '/api/pieces/:number/tracking-link/revoke',
    roles: ['owner'],
    handler: async (ctx) => {
      const user = signedInUser(ctx);
      const number = ctx.params.number as string;
      const row = await findPieceJoined(number);
      if (!row) throw errors.notFound();
      if (row.owner_kind !== 'guest') {
        throw errors.conflict('not_a_guest_piece', 'Only guest pieces have tracking links.');
      }
      await withTransaction(async (client) => {
        await revokeTrackingLinks(client, number);
        await addHistory(client, number, user.name, 'tracking revoked');
      });
      return { status: 200, body: { tracking: 'revoked' } };
    },
  },
  {
    method: 'POST',
    path: '/api/pieces/:number/tracking-link',
    roles: ['owner'],
    handler: async (ctx) => {
      const user = signedInUser(ctx);
      const number = ctx.params.number as string;
      const row = await findPieceJoined(number);
      if (!row) throw errors.notFound();
      if (row.owner_kind !== 'guest') {
        throw errors.conflict('not_a_guest_piece', 'Only guest pieces have tracking links.');
      }
      const token = await withTransaction(async (client) => {
        const fresh = await createTrackingLink(client, number);
        await addHistory(client, number, user.name, 'tracking replaced');
        if (row.guest_email) {
          await queueMessage(
            client,
            newTrackingLink({
              to: row.guest_email,
              pieceNumber: number,
              trackingUrl: trackingUrl(fresh),
            }),
          );
        }
        return fresh;
      });
      return { status: 201, body: { tracking_url: trackingUrl(token) } };
    },
  },
  {
    method: 'GET',
    path: '/api/track/:token',
    roles: 'anyone',
    handler: async (ctx) => {
      const row = await pieceForToken(ctx.params.token as string);
      if (!row) throw errors.notFound(DEAD_LINK);
      const status = pieceStatusOf(row, ctx.now);
      const view: TrackingView = {
        piece_number: row.number,
        status,
        status_label: PIECE_STATUS_LABELS[status],
        pickup_shelf: status === 'ready' || status === 'uncollected' ? row.pickup_shelf : null,
      };
      return { status: 200, body: view };
    },
  },
];
