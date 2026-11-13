import multer from "multer";
import { createHash, randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { AppError, validationError } from "./errors.js";
import { isStaff, requireUser } from "./http.js";
import type { SessionUser, Shape, Plan, GlazeCone, Cone, RateSet, QuoteResult } from "./domain.js";
import type { Store, PieceRow } from "./store.js";
import { checkLimits, coneAtOrBelow, cubicInches, dec, feeWithMinimum, fromString, planStage, rateForPlan, roundedSides, toString as decToString, type Dec } from "./rules.js";

export const upload = multer({ storage: multer.memoryStorage() });

export interface ValidatedIntake {
  shape: Shape;
  unit: "in" | "cm";
  length?: string;
  width?: string;
  diameter?: string;
  height?: string;
  plan: Plan;
  clay_id: string;
  cone: GlazeCone | null;
  photo_id: string;
  guest_name?: string;
  guest_email?: string;
}

export interface QuoteParts {
  sides: { length: Dec | null; width: Dec | null; diameter: Dec | null; height: Dec };
  cubic: Dec;
  rate: Dec;
  discount: number;
  fee: { amountCents: number; minimumApplied: boolean };
  rateSet: RateSet;
}

// Shared intake/quote validation and fee computation. Each fee number comes
// from here, so the arithmetic has one home.
export async function quoteParts(
  store: Store,
  body: Record<string, unknown>,
  isMember: boolean
): Promise<QuoteParts> {
  const shape = String(body.shape ?? "");
  const unit = String(body.unit ?? "in");
  const plan = String(body.plan ?? "");
  if (shape !== "round" && shape !== "rectangular" && shape !== "plate") {
    throw validationError({ shape: "Choose a shape" });
  }
  if (unit !== "in" && unit !== "cm") {
    throw validationError({ unit: "Choose cm or in" });
  }
  if (plan !== "bisque_and_glaze" && plan !== "bisque_only" && plan !== "glaze_only") {
    throw validationError({ plan: "Choose a firing plan" });
  }
  const fields: Record<string, string> = {};
  const raw = {
    length: body.length === undefined || body.length === null ? undefined : String(body.length),
    width: body.width === undefined || body.width === null ? undefined : String(body.width),
    diameter: body.diameter === undefined || body.diameter === null ? undefined : String(body.diameter),
    height: body.height === undefined || body.height === null ? undefined : String(body.height)
  };
  const sides = roundedSides(shape as Shape, unit as "in" | "cm", raw, fields);
  if (sides === null) {
    for (const key of shape === "rectangular" ? ["length", "width", "height"] : ["diameter", "height"]) {
      if (!fields[key]) fields[key] = "Enter a size above 0";
    }
    throw validationError(fields);
  }
  const safeSides: { length: Dec | null; width: Dec | null; diameter: Dec | null; height: Dec } = {
    length: sides.length,
    width: sides.width,
    diameter: sides.diameter,
    height: sides.height
  };
  const kilns = await store.kilns();
  const tallestPost = kilns.reduce((max, k) => Math.max(max, Number(k.post_height_in)), 0);
  const heightLimit = dec(BigInt(Math.round((tallestPost - 1) * 10)), 1);
  checkLimits(safeSides, heightLimit, fields);
  if (Object.keys(fields).length) {
    throw validationError(fields);
  }
  const rateSet = await store.rateSetInEffect(store.today());
  if (!rateSet) {
    throw new AppError(404, "not_found", "Not found.");
  }
  const cubic = cubicInches(safeSides);
  const bisqueRate = fromString(rateSet.bisque_rate, 4);
  const glazeRate = fromString(rateSet.glaze_rate, 4);
  const rate = rateForPlan(plan as Plan, bisqueRate, glazeRate);
  const discount = isMember ? rateSet.member_discount_percent : 0;
  const fee = feeWithMinimum({
    cubic,
    rate,
    discountPercent: discount,
    orderMinimumCents: rateSet.order_minimum_cents
  });
  return { sides: safeSides, cubic, rate, discount, fee, rateSet };
}

export function quoteResult(parts: QuoteParts): QuoteResult {
  const { sides, cubic, rate, discount, fee, rateSet } = parts;
  return {
    sides_in: {
      length: sides.length ? decToString(sides.length, 1) : undefined,
      width: sides.width ? decToString(sides.width, 1) : undefined,
      diameter: sides.diameter ? decToString(sides.diameter, 1) : undefined,
      height: decToString(sides.height, 1)
    },
    cubic_inches: decToString(cubic, 3),
    rate_per_cubic_inch: decToString(rate, 4),
    discount_percent: discount,
    order_minimum_cents: rateSet.order_minimum_cents,
    minimum_applied: fee.minimumApplied,
    fee_cents: fee.amountCents,
    rate_set_id: rateSet.id
  };
}

// Validates the full intake body (sizes, clay, cone, photo, guest fields).
export async function validateIntake(
  store: Store,
  body: Record<string, unknown>,
  guest: boolean
): Promise<{ input: ValidatedIntake; parts: QuoteParts }> {
  const shape = String(body.shape ?? "");
  const unit = String(body.unit ?? "in");
  const plan = String(body.plan ?? "");
  if (shape !== "round" && shape !== "rectangular" && shape !== "plate") {
    throw validationError({ shape: "Choose a shape" });
  }
  if (unit !== "in" && unit !== "cm") {
    throw validationError({ unit: "Choose cm or in" });
  }
  if (plan !== "bisque_and_glaze" && plan !== "bisque_only" && plan !== "glaze_only") {
    throw validationError({ plan: "Choose a firing plan" });
  }
  const fields: Record<string, string> = {};
  const clayId = String(body.clay_id ?? "");
  const clays = await store.clays();
  const clay = clays.find((c) => c.id === clayId);
  if (!clay) {
    fields.clay_id = "Choose a clay body";
  }
  let cone: GlazeCone | null = null;
  if (plan !== "bisque_only") {
    const coneRaw = body.cone === undefined || body.cone === null ? "" : String(body.cone);
    if (coneRaw !== "06" && coneRaw !== "6") {
      fields.cone = "Choose a glaze cone";
    } else if (clay && !coneAtOrBelow(coneRaw as Cone, clay.max_cone as Cone)) {
      fields.cone = `Clay not rated for cone ${coneRaw}`;
    } else {
      cone = coneRaw as GlazeCone;
    }
  }
  if (guest) {
    const name = String(body.guest_name ?? "").trim();
    if (!name) {
      fields.guest_name = "Enter a name";
    }
    const email = String(body.guest_email ?? "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      fields.guest_email = "Enter a valid email";
    }
  }
  const photoId = body.photo_id === undefined || body.photo_id === null ? "" : String(body.photo_id);
  if (!photoId) {
    fields.photo_id = "Add a photo of the piece";
  }
  if (Object.keys(fields).length) {
    throw validationError(fields);
  }
  // Sizes and fee: shared with the quote endpoint.
  const parts = await quoteParts(store, { ...body, shape, unit, plan }, !guest);
  const stage = planStage(plan as Plan, null);
  void stage;
  return {
    input: {
      shape: shape as Shape,
      unit: unit as "in" | "cm",
      length: body.length === undefined || body.length === null ? undefined : String(body.length),
      width: body.width === undefined || body.width === null ? undefined : String(body.width),
      diameter: body.diameter === undefined || body.diameter === null ? undefined : String(body.diameter),
      height: body.height === undefined || body.height === null ? undefined : String(body.height),
      plan: plan as Plan,
      clay_id: clayId,
      cone,
      photo_id: photoId,
      guest_name: guest ? String(body.guest_name).trim() : undefined,
      guest_email: guest ? String(body.guest_email).trim() : undefined
    },
    parts
  };
}

export function receiptBody(
  parts: QuoteParts,
  pieceNumber: number,
  guest: boolean,
  trackingUrl: string | null
): string {
  const { sides, cubic, rate, discount, fee } = parts;
  const lines: string[] = [];
  if (sides.length && sides.width) {
    lines.push(`Rounded sides: ${decToString(sides.length, 1)} in x ${decToString(sides.width, 1)} in x ${decToString(sides.height, 1)} in`);
  } else if (sides.diameter) {
    lines.push(`Rounded diameter: ${decToString(sides.diameter, 1)} in`);
    lines.push(`Rounded height: ${decToString(sides.height, 1)} in`);
  }
  lines.push(`Cubic inches: ${decToString(cubic, 3)} in³`);
  lines.push(`Rate per cubic inch: $${decToString(rate, 4)}`);
  lines.push(`Discount: ${discount}%`);
  lines.push(`Order minimum applied: ${fee.minimumApplied ? "yes" : "no"}`);
  lines.push(`Fee $${centsToDollars(fee.amountCents)}`);
  if (guest) {
    lines.push(`Amount due $${centsToDollars(fee.amountCents)}`);
    if (trackingUrl) lines.push(`Track your piece: ${trackingUrl}`);
  }
  return lines.join("\n");
}

export function centsToDollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function pieceNumberFormatted(n: number): string {
  return String(n).padStart(4, "0");
}

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sha256Hex(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export async function visiblePiece(user: SessionUser, store: Store, number: number): Promise<PieceRow> {
  const row = await store.pieceByNumber(number);
  if (!row) {
    throw new AppError(404, "not_found", "Not found.");
  }
  if (user.role === "member" && (row.owner_kind !== "member" || row.owner_member_number !== user.member_number)) {
    throw new AppError(404, "not_found", "Not found.");
  }
  return row;
}

export function currentUser(req: Request): SessionUser {
  return requireUser(req);
}

export function isStaffUser(user: SessionUser): boolean {
  return isStaff(user);
}
