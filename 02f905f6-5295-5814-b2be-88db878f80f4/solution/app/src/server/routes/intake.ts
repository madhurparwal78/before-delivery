// Fee quotes, member intakes, guest drop-offs and the counter payment for a drop-off.
// Intake and drop-off run photo, charge and receipt in order; the piece exists only after all three.
import { randomBytes, randomUUID } from "node:crypto";
import type { Dropoff, Plan, Quote, User } from "../../shared/api";
import { clayRatedFor, GLAZE_CONES, isCone, type Cone } from "../../shared/rules";
import { allow } from "../auth";
import { config } from "../config";
import { pool, tx } from "../db";
import { fieldsOf, HttpError, invalidFields, notFound, type Route } from "../http";
import { BillingRefused, BillingUnavailable, ensureAccount, externalCharge, invoiceBalanceCents, payInvoice, voidInvoice } from "../killbill";
import { heightLimitHalves } from "../load";
import { MailUnavailable, receipt, send } from "../mail";
import { dollars } from "../../shared/money";
import { fee, formatCubic, formatRate, measure, quoteOut, sidesOut, sizeKeys, type Measured } from "../measure";
import { addHistory, parsePieceNumber, pieceByNumber, pieceNumberText, pieceRows } from "../pieces";
import { StorageUnavailable, storedSize } from "../storage";
import { rateSetInEffect } from "./rates";
import { memberAccountId, userRow } from "./studio";

type Step = "photo" | "charge" | "receipt";

const STEP_COPY: Record<Step, string> = {
  photo: "Intake stopped at the photo step: the photo could not be confirmed. Nothing was charged.",
  charge: "Intake stopped at the charge step: billing is unreachable. Nothing was charged.",
  receipt: "Intake stopped at the receipt step: email is unreachable. The charge was voided.",
};

const stopped = (step: Step) => new HttpError(503, "intake_failed", STEP_COPY[step], { step });

/** Voids the charge of a failed intake; a void Kill Bill refuses three times is reported, never claimed. */
async function voidCharge(invoiceId: string): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await voidInvoice(invoiceId);
      return;
    } catch (error) {
      if (attempt === 3) {
        console.error(`void of invoice ${invoiceId} failed:`, (error as Error).message);
        throw new HttpError(503, "intake_failed", "Intake stopped at the receipt step: email is unreachable, and the charge could not be voided yet.", { step: "receipt" });
      }
    }
  }
}

async function quote(user: User, body: Record<string, unknown>): Promise<Quote> {
  const fields: Record<string, string> = {};
  const sizes = measure(body, await heightLimitHalves(pool), fields);
  if (!sizes) throw invalidFields(fields);
  const rates = await rateSetInEffect(pool, new Date());
  return quoteOut(sizes, fee(sizes.cubicEighths, sizes.plan, rates, user.role === "member"), rates.id);
}

interface Guest {
  name: string;
  email: string;
}

interface ValidIntake {
  sizes: Measured & { plan: Plan };
  clayId: string;
  cone: Cone | null;
  photoId: string;
  guest: Guest | null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function validate(user: User, body: Record<string, unknown>, asGuest: boolean): Promise<ValidIntake> {
  const fields: Record<string, string> = {};
  const sizes = measure(body, await heightLimitHalves(pool), fields);
  const clay = typeof body.clay_id === "string" ? (await pool.query<{ id: string; max_cone: Cone }>("SELECT id, max_cone FROM clays WHERE id = $1", [body.clay_id])).rows[0] : undefined;
  if (!clay) fields.clay_id = "Choose a clay body";
  const plan = body.plan;
  let cone: Cone | null = null;
  if (plan === "bisque_and_glaze" || plan === "glaze_only") {
    const raw = typeof body.cone === "number" ? String(body.cone) : body.cone;
    if (!isCone(raw) || !GLAZE_CONES.includes(raw)) fields.cone = "Choose a glaze cone";
    else if (clay && !clayRatedFor(clay.max_cone, raw)) fields.cone = `Clay not rated for cone ${raw}`;
    else cone = raw;
  }
  const photoId = typeof body.photo_id === "string" ? body.photo_id : "";
  const photo = photoId
    ? (await pool.query<{ uploader_id: number; attached: boolean }>("SELECT uploader_id, attached FROM photos WHERE id = $1", [photoId])).rows[0]
    : undefined;
  if (!photo) fields.photo_id = "Add a photo of the piece";
  else if (photo.attached || photo.uploader_id !== user.id) fields.photo_id = "Photo already used or not yours";
  let guest: Guest | null = null;
  if (asGuest) {
    const name = typeof body.guest_name === "string" ? body.guest_name.trim() : "";
    const email = typeof body.guest_email === "string" ? body.guest_email.trim() : "";
    if (!name) fields.guest_name = "Enter a name";
    if (!EMAIL.test(email)) fields.guest_email = "Enter a valid email";
    guest = { name, email };
  }
  if (!sizes || !clay || Object.keys(fields).length > 0) throw invalidFields(fields);
  return { sizes, clayId: clay.id, cone, photoId, guest };
}

/** A tracking token with 192 bits of randomness, URL-safe. */
export function newTrackingToken(): { token: string; url: string } {
  const token = randomBytes(24).toString("base64url");
  return { token, url: trackingUrl(token) };
}

export const trackingUrl = (token: string) => `${config.publicUrl}/track/${token}`;

interface Accepted {
  number: number;
  trackingUrl: string | null;
}

/** Photo, charge and receipt, then the piece; any failed step leaves nothing behind. */
async function accept(user: User, intake: ValidIntake): Promise<Accepted> {
  return tx(async (client) => {
    const photo = (await client.query<{ bytes: number; attached: boolean }>("SELECT bytes, attached FROM photos WHERE id = $1 FOR UPDATE", [intake.photoId])).rows[0];
    if (photo.attached) throw invalidFields({ photo_id: "Photo already used or not yours" });
    try {
      if ((await storedSize(intake.photoId)) !== photo.bytes) throw stopped("photo");
    } catch (error) {
      if (error instanceof StorageUnavailable) throw stopped("photo");
      throw error;
    }

    const now = new Date();
    const number = Number((await client.query<{ n: string }>("SELECT nextval('piece_numbers') AS n")).rows[0].n);
    const label = pieceNumberText(number);
    const rates = await rateSetInEffect(client, now);
    const { sizes, guest } = intake;
    const charge = fee(sizes.cubicEighths, sizes.plan, rates, guest === null);
    const toName = guest?.name ?? user.name;
    const toAddress = guest?.email ?? (await client.query<{ email: string }>("SELECT email FROM users WHERE id = $1", [user.id])).rows[0].email;

    let accountId: string;
    let invoiceId: string;
    try {
      accountId = guest ? await ensureAccount(`guest-${label}`, guest.name, guest.email) : await memberAccountId(client, await userRow(client, user.id));
      invoiceId = await externalCharge(accountId, charge.feeCents, `Firing Piece ${label}`);
    } catch (error) {
      if (error instanceof BillingUnavailable || error instanceof BillingRefused) throw stopped("charge");
      throw error;
    }

    const tracking = guest ? newTrackingToken() : null;
    const sides = sidesOut(sizes.shape, sizes.sides);
    const sideText = sizeKeys(sizes.shape)
      .map((key) => `${sides[key]} in`)
      .join(" × ");
    try {
      await send(
        receipt(toAddress, toName, {
          number: label,
          sides: sideText,
          cubic: formatCubic(sizes.cubicEighths),
          rate: formatRate(charge.rateUnits),
          discountPercent: charge.discountPercent,
          minimumApplied: charge.minimumApplied,
          minimum: dollars(charge.orderMinimumCents),
          fee: dollars(charge.feeCents),
          trackingUrl: tracking?.url ?? null,
        }),
      );
    } catch (error) {
      if (!(error instanceof MailUnavailable)) throw error;
      await voidCharge(invoiceId);
      throw stopped("receipt");
    }

    await client.query(
      `INSERT INTO pieces (number, member_id, guest_name, guest_email, shape, length_halves, width_halves, diameter_halves,
         height_halves, cubic_eighths, rate_ten_thousandths, discount_percent, order_minimum_cents, minimum_applied, fee_cents,
         rate_set_id, plan, stage, cone, clay_id, status, intake_photo_id, accepted_at, kb_account_id, kb_invoice_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)`,
      [
        number,
        guest ? null : user.id,
        guest?.name ?? null,
        guest?.email ?? null,
        sizes.shape,
        sizes.sides.length ?? null,
        sizes.sides.width ?? null,
        sizes.sides.diameter ?? null,
        sizes.sides.height,
        sizes.cubicEighths,
        charge.rateUnits,
        charge.discountPercent,
        charge.orderMinimumCents,
        charge.minimumApplied,
        charge.feeCents,
        rates.id,
        sizes.plan,
        sizes.plan === "glaze_only" ? "glaze" : "bisque",
        intake.cone,
        intake.clayId,
        guest ? "awaiting_payment" : "queued",
        intake.photoId,
        now,
        accountId,
        invoiceId,
      ],
    );
    await client.query("UPDATE photos SET attached = true WHERE id = $1", [intake.photoId]);
    await addHistory(client, number, user.name, "accepted", now);
    if (tracking) {
      await client.query("INSERT INTO tracking_links (token, piece_number, active, created_at) VALUES ($1, $2, true, now())", [
        tracking.token,
        number,
      ]);
    }
    return { number, trackingUrl: tracking?.url ?? null };
  });
}

export const intakeRoutes: Route[] = [
  {
    method: "POST",
    path: "/api/quote",
    auth: true,
    body: "json",
    handler: async (ctx) => ({ status: 200, body: await quote(ctx.user, fieldsOf(ctx.body)) }),
  },
  {
    method: "POST",
    path: "/api/intakes",
    idempotent: true,
    auth: true,
    body: "json",
    handler: async (ctx) => {
      allow(ctx.user, "member");
      const accepted = await accept(ctx.user, await validate(ctx.user, fieldsOf(ctx.body), false));
      return { status: 201, body: await pieceByNumber(accepted.number) };
    },
  },
  {
    method: "POST",
    path: "/api/dropoffs",
    idempotent: true,
    auth: true,
    body: "json",
    handler: async (ctx) => {
      allow(ctx.user, "owner", "tech");
      const accepted = await accept(ctx.user, await validate(ctx.user, fieldsOf(ctx.body), true));
      const piece = await pieceByNumber(accepted.number);
      const body: Dropoff = { piece, amount_due_cents: piece.fee_cents, payment_status: "owed", tracking_url: accepted.trackingUrl ?? "" };
      return { status: 201, body };
    },
  },
  {
    method: "POST",
    path: "/api/dropoffs/:number/payment",
    idempotent: true,
    auth: true,
    body: "json",
    handler: async (ctx) => {
      const number = parsePieceNumber(ctx.params.number);
      const [found] = number === null ? [] : await pieceRows(pool, "p.number = $1 AND p.member_id IS NULL", [number]);
      // A member can never see a guest drop-off, so it does not exist for them.
      if (!found || ctx.user.role === "member") throw notFound();
      const paidCents = await tx(async (client) => {
        const [piece] = await pieceRows(client, "p.number = $1", [found.number], true);
        if (piece.status !== "awaiting_payment") throw new HttpError(409, "already_paid", "Already paid.");
        let paid: number;
        try {
          const balance = await invoiceBalanceCents(piece.kb_invoice_id);
          paid = await payInvoice(piece.kb_account_id, piece.kb_invoice_id, balance, `dropoff-${piece.kb_invoice_id}-${randomUUID()}`);
        } catch (error) {
          if (error instanceof BillingUnavailable) {
            throw new HttpError(503, "billing_unavailable", "Payment not recorded — billing is unreachable. The piece stays Owed.");
          }
          if (error instanceof BillingRefused) {
            throw new HttpError(502, "payment_failed", "Payment not recorded — billing refused the payment. The piece stays Owed.");
          }
          throw error;
        }
        if (paid < piece.fee_cents) {
          throw new HttpError(502, "payment_failed", "Payment not recorded — billing refused the payment. The piece stays Owed.");
        }
        await client.query("UPDATE pieces SET status = 'queued' WHERE number = $1", [piece.number]);
        await addHistory(client, piece.number, ctx.user.name, "paid");
        return paid;
      });
      return { status: 200, body: { payment_status: "paid", paid_cents: paidCents, piece: await pieceByNumber(found.number) } };
    },
  },
];
