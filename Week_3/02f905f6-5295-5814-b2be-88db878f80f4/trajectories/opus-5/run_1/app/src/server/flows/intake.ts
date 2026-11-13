import { randomBytes } from 'node:crypto';
import type { GlazeCone, Piece, Plan, Quote } from '../../shared/types';
import { stageOfPlan } from '../../shared/labels';
import { withTransaction } from '../db/pool';
import {
  checkCone,
  measure,
  MSG,
  parsePlan,
  sidesInOf,
  type FieldErrors,
  type Measured,
} from '../domain/measure';
import { quoteOf } from '../domain/fee';
import { studioDate } from '../domain/time';
import { findClay, maxPieceHeightHalfUnits, rateSetFor } from '../repo/catalog';
import { attachPhoto, findPhoto, type PhotoRow } from '../repo/photos';
import {
  addHistory,
  insertPiece,
  loadPiece,
  nextPieceNumber,
  trackingUrl,
  TRACKING_TOKEN_BYTES,
} from '../repo/pieces';
import type { UserRow } from '../repo/users';
import { ProviderDown } from '../http/errors';
import * as errors from '../http/errors';
import { confirmPhoto } from '../services/storage';
import { postExternalCharge, voidInvoice } from '../services/killbill';
import { guestAccountId, memberAccountId } from '../services/accounts';
import { intakeReceipt } from '../services/messages';
import { sendMessage } from '../services/mail';

export type IntakeOwner =
  | { kind: 'member'; user: UserRow }
  | { kind: 'guest'; name: string; email: string };

export interface IntakeOutcome {
  piece: Piece;
  quote: Quote;
  email: string;
  trackingToken: string | null;
}

interface PricedIntake {
  measured: Measured;
  quote: Quote;
  photo: PhotoRow;
  clayId: string;
  cone: GlazeCone | null;
  plan: Plan;
  guest: { name: string; email: string } | null;
}

function readGuest(body: Record<string, unknown>, fields: FieldErrors): { name: string; email: string } {
  const name = typeof body.guest_name === 'string' ? body.guest_name.trim() : '';
  const email = typeof body.guest_email === 'string' ? body.guest_email.trim() : '';
  if (name === '') fields.guest_name = MSG.guestName;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fields.guest_email = MSG.guestEmail;
  return { name, email };
}

/** Validates everything an intake or drop-off needs, then prices it. */
async function priceIntake(args: {
  body: Record<string, unknown>;
  uploaderId: string;
  owner: IntakeOwner;
  now: Date;
}): Promise<PricedIntake> {
  const fields: FieldErrors = {};
  const outcome = measure(args.body, await maxPieceHeightHalfUnits());
  Object.assign(fields, outcome.fields);

  const plan = parsePlan(args.body.plan);
  if (!plan) fields.plan = MSG.plan;

  const clay = await findClay(args.body.clay_id);
  if (!clay) fields.clay_id = MSG.clay;

  let cone: GlazeCone | null = null;
  if (plan) {
    const checked = checkCone(plan, args.body.cone, clay?.max_cone ?? null);
    if (checked.error) fields.cone = checked.error;
    cone = checked.cone;
  }

  const photo = await findPhoto(args.body.photo_id);
  if (!photo) fields.photo_id = MSG.photoMissing;
  else if (photo.attached || photo.uploader_id !== args.uploaderId) {
    fields.photo_id = MSG.photoUsed;
  }

  const guest = args.owner.kind === 'guest' ? readGuest(args.body, fields) : null;

  if (Object.keys(fields).length > 0) throw errors.unprocessable(fields);

  const rateSet = await rateSetFor(studioDate(args.now));
  if (!rateSet) throw errors.conflict('no_rate_set', 'No firing rates are in effect.');

  const measured = outcome.measured as Measured;
  const checkedPlan = plan as Plan;
  return {
    measured,
    quote: quoteOf({
      sidesIn: sidesInOf(measured),
      cubicMilli: measured.cubicMilli,
      plan: checkedPlan,
      rateSet,
      isMember: args.owner.kind === 'member',
    }),
    photo: photo as PhotoRow,
    clayId: (clay as NonNullable<typeof clay>).id,
    cone,
    plan: checkedPlan,
    guest,
  };
}

/**
 * Photo, charge, receipt — in that order, all of them or none. A failed step
 * leaves no piece and no unvoided charge, and names itself in the refusal.
 */
export async function runIntake(args: {
  body: Record<string, unknown>;
  actor: UserRow;
  owner: IntakeOwner;
  now: Date;
}): Promise<IntakeOutcome> {
  const priced = await priceIntake({
    body: args.body,
    uploaderId: args.actor.id,
    owner: args.owner,
    now: args.now,
  });
  const isGuest = args.owner.kind === 'guest';
  const email = args.owner.kind === 'member' ? args.owner.user.email : (priced.guest as { email: string }).email;
  const ownerName = args.owner.kind === 'member' ? args.owner.user.name : (priced.guest as { name: string }).name;
  const number = await nextPieceNumber();

  try {
    await confirmPhoto(priced.photo.id, priced.photo.bytes);
  } catch (error) {
    if (error instanceof ProviderDown) throw errors.intakeFailed('photo');
    throw error;
  }

  let accountId: string;
  let invoiceId: string;
  try {
    accountId = isGuest
      ? await guestAccountId({ pieceNumber: number, name: ownerName, email })
      : await memberAccountId((args.owner as { user: UserRow }).user);
    invoiceId = await postExternalCharge({
      accountId,
      amountCents: priced.quote.fee_cents,
      description: `Firing Piece ${number}`,
    });
  } catch (error) {
    if (error instanceof ProviderDown) throw errors.intakeFailed('charge');
    throw error;
  }

  const trackingToken = isGuest ? randomBytes(TRACKING_TOKEN_BYTES).toString('base64url') : null;
  try {
    await sendMessage(
      intakeReceipt({
        to: email,
        pieceNumber: number,
        quote: priced.quote,
        trackingUrl: trackingToken ? trackingUrl(trackingToken) : null,
      }),
    );
  } catch (error) {
    if (error instanceof ProviderDown) {
      await voidInvoice(invoiceId);
      throw errors.intakeFailed('receipt');
    }
    throw error;
  }

  try {
    await withTransaction(async (client) => {
      if (!(await attachPhoto(client, priced.photo.id))) {
        throw errors.unprocessable({ photo_id: MSG.photoUsed });
      }
      await insertPiece(client, {
        number,
        ownerKind: args.owner.kind,
        ownerUserId: args.owner.kind === 'member' ? args.owner.user.id : null,
        guestName: isGuest ? ownerName : null,
        guestEmail: isGuest ? email : null,
        kbAccountId: accountId,
        shape: priced.measured.shape,
        widthHalf: priced.measured.width,
        depthHalf: priced.measured.depth,
        heightHalf: priced.measured.height,
        cubicMilli: priced.measured.cubicMilli,
        feeCents: priced.quote.fee_cents,
        rateSetId: priced.quote.rate_set_id,
        plan: priced.plan,
        stage: stageOfPlan(priced.plan),
        cone: priced.cone,
        clayId: priced.clayId,
        status: isGuest ? 'awaiting_payment' : 'queued',
        intakePhotoId: priced.photo.id,
        invoiceId,
        paymentStatus: isGuest ? 'owed' : null,
      });
      await addHistory(client, number, args.actor.name, 'accepted');
      if (trackingToken) {
        await client.query('insert into tracking_links (token, piece_number) values ($1, $2)', [
          trackingToken,
          number,
        ]);
      }
    });
  } catch (error) {
    await voidInvoice(invoiceId);
    throw error;
  }

  return {
    piece: (await loadPiece(number)) as Piece,
    quote: priced.quote,
    email,
    trackingToken,
  };
}
