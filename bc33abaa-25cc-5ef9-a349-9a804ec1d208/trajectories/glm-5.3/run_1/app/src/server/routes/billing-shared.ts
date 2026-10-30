import type { Request } from "express";
import { errors } from "../http";
import { parseLocal } from "./members";
import { createHash } from "node:crypto";

export { parseLocal };

export async function callerWsShared(req: Request): Promise<{ ws: string; role: string; timeZone: string }> {
  const caller = req.caller!;
  if (caller.kind === "agent") throw errors.forbidden();
  return { ws: caller.member.workspace_id, role: caller.member.role, timeZone: caller.workspace.time_zone };
}

export interface CardInput {
  number: string;
  expMonth: number;
  expYear: number;
  cvc: string;
}

export function parseCard(raw: unknown): { card?: CardInput; errors: Record<string, string> } {
  const fieldErrors: Record<string, string> = {};
  if (typeof raw !== "object" || raw === null) {
    return { errors: { card: "Card is required" } };
  }
  const c = raw as Record<string, unknown>;
  const number = c.number;
  const expMonth = c.expMonth;
  const expYear = c.expYear;
  const cvc = c.cvc;
  if (typeof number !== "string" || !/^\d{13,19}$/.test(number) || !luhn(number)) {
    fieldErrors["card.number"] = "Card number is invalid";
  }
  if (typeof expMonth !== "number" || !Number.isInteger(expMonth) || expMonth < 1 || expMonth > 12) {
    fieldErrors["card.expMonth"] = "Expiry month is invalid";
  }
  if (typeof expYear !== "number" || !Number.isInteger(expYear) || expYear < 1000 || expYear > 9999) {
    fieldErrors["card.expYear"] = "Expiry year is invalid";
  }
  if (typeof cvc !== "string" || !/^\d{3,4}$/.test(cvc)) {
    fieldErrors["card.cvc"] = "CVC is invalid";
  }
  if (Object.keys(fieldErrors).length > 0) return { errors: fieldErrors };
  return { card: { number: number as string, expMonth: expMonth as number, expYear: expYear as number, cvc: cvc as string }, errors: {} };
}

export function cardIsCurrent(card: CardInput, now: Date): boolean {
  const expiry = new Date(Date.UTC(card.expYear, card.expMonth, 0, 23, 59, 59));
  return expiry.getTime() >= now.getTime();
}

export function cardIsDeclined(card: CardInput): boolean {
  return card.number === "4000000000000002";
}

function luhn(number: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let i = number.length - 1; i >= 0; i--) {
    let d = Number(number[i]);
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

export const PLAN_CATALOG: Record<string, { name: string; priceCents: number; includedSeats: number; seatPriceCents: number; kbPlan: string; kbSeatPlan: string }> = {
  "team-monthly": { name: "Team", priceCents: 9600, includedSeats: 8, seatPriceCents: 1200, kbPlan: "team-monthly", kbSeatPlan: "seat-team-monthly" },
  "team-annual": { name: "Team", priceCents: 96000, includedSeats: 8, seatPriceCents: 12000, kbPlan: "team-annual", kbSeatPlan: "seat-team-annual" },
  "business-monthly": { name: "Business", priceCents: 38000, includedSeats: 20, seatPriceCents: 1600, kbPlan: "business-monthly", kbSeatPlan: "seat-business-monthly" },
  "business-annual": { name: "Business", priceCents: 380000, includedSeats: 20, seatPriceCents: 16000, kbPlan: "business-annual", kbSeatPlan: "seat-business-annual" },
};

export function planKey(plan: string, period: string): string {
  return `${plan}-${period}`;
}

export function isUpgrade(fromPlan: string, fromPeriod: string, toPlan: string, toPeriod: string): boolean {
  if (fromPlan === "team" && toPlan === "business") return true;
  if (fromPlan === toPlan && fromPeriod === "monthly" && toPeriod === "annual") return true;
  return false;
}

export function bodyHash(body: unknown): string {
  return createHash("sha256").update(typeof body === "string" ? body : JSON.stringify(body ?? {})).digest("hex");
}
