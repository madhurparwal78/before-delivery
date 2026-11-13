import type { DropoffResult } from '../../shared/types';
import { signedInUser, type Route } from '../http/router';
import * as errors from '../http/errors';
import { withTransaction } from '../db/pool';
import { runIntake } from '../flows/intake';
import { addHistory, findPieceJoined, loadPiece, markPaid, trackingUrl } from '../repo/pieces';
import { payInvoiceFully } from '../services/killbill';
import { PaymentDeclined } from '../http/errors';

export const intakeRoutes: Route[] = [
  {
    method: 'POST',
    path: '/api/intakes',
    roles: ['member'],
    idempotent: true,
    handler: async (ctx) => {
      const user = signedInUser(ctx);
      const outcome = await runIntake({
        body: ctx.body,
        actor: user,
        owner: { kind: 'member', user },
        now: ctx.now,
      });
      return { status: 201, body: outcome.piece };
    },
  },
  {
    method: 'POST',
    path: '/api/dropoffs',
    roles: ['tech', 'owner'],
    idempotent: true,
    handler: async (ctx) => {
      const user = signedInUser(ctx);
      const outcome = await runIntake({
        body: ctx.body,
        actor: user,
        owner: {
          kind: 'guest',
          name: typeof ctx.body.guest_name === 'string' ? ctx.body.guest_name.trim() : '',
          email: typeof ctx.body.guest_email === 'string' ? ctx.body.guest_email.trim() : '',
        },
        now: ctx.now,
      });
      const body: DropoffResult = {
        piece: outcome.piece,
        amount_due_cents: outcome.piece.fee_cents,
        payment_status: 'owed',
        tracking_url: trackingUrl(outcome.trackingToken as string),
      };
      return { status: 201, body };
    },
  },
  {
    method: 'POST',
    path: '/api/dropoffs/:number/payment',
    roles: ['tech', 'owner'],
    idempotent: true,
    handler: async (ctx) => {
      const user = signedInUser(ctx);
      const number = ctx.params.number as string;
      const row = await findPieceJoined(number);
      if (!row || row.owner_kind !== 'guest') throw errors.notFound();
      if (row.payment_status === 'paid') {
        throw errors.conflict('already_paid', 'Already paid.');
      }

      // The row stays locked while Kill Bill works, so one payment is made.
      const paidCents = await withTransaction(async (client) => {
        const held = await client.query<{ payment_status: string; invoice_id: string }>(
          'select payment_status, invoice_id from pieces where number = $1 for update',
          [number],
        );
        const piece = held.rows[0];
        if (!piece) throw errors.notFound();
        if (piece.payment_status === 'paid') throw errors.conflict('already_paid', 'Already paid.');
        const cents = await payInvoiceFully(row.kb_account_id as string, piece.invoice_id);
        if (cents < row.fee_cents) throw new PaymentDeclined('short payment');
        if (!(await markPaid(client, number))) {
          throw errors.conflict('already_paid', 'Already paid.');
        }
        await addHistory(client, number, user.name, 'paid');
        return cents;
      });

      return {
        status: 200,
        body: {
          payment_status: 'paid',
          paid_cents: paidCents,
          piece: await loadPiece(number),
        },
      };
    },
  },
];
