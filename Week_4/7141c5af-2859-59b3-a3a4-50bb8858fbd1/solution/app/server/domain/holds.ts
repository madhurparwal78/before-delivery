import { copy } from "./copy.ts";
import { amountCopy } from "./estimate.ts";
import { addDays, dateCopy, turinToday } from "./time.ts";

/** A hold's amount: whole hides as a number, metres as a two-decimal string. */
export type HoldQuantity = number | string;

export interface HeldLot {
  code: string;
  lot: string;
  quantity: HoldQuantity;
  endsOn: string;
}

export function holdEndsOn(holdDays: number): string {
  return addDays(turinToday(), holdDays);
}

/** A hold lasts through its last day, Turin time. */
export function isLive(endsOn: string): boolean {
  return endsOn >= turinToday();
}

export function holdLabel(endsOn: string): string {
  return copy(isLive(endsOn) ? "F-33" : "F-34", { date: dateCopy(endsOn) });
}

type HoldDecision = { kind: "same"; hold: HeldLot } | { kind: "refused"; message: string } | { kind: "new" };

/** The first four steps of a hold request, in the published order; the lot checks follow from the supplier's stock. */
export function decideHold(holds: readonly HeldLot[], code: string, lot: string, quantity: HoldQuantity): HoldDecision {
  const sameLot = holds.find((hold) => hold.code === code && hold.lot === lot);
  if (sameLot && isLive(sameLot.endsOn) && sameLot.quantity === quantity) return { kind: "same", hold: sameLot };
  if (sameLot && !isLive(sameLot.endsOn)) return { kind: "refused", message: copy("F-34", { date: dateCopy(sameLot.endsOn) }) };
  if (sameLot) return { kind: "refused", message: copy("F-41", { q: amountCopy(sameLot.quantity) }) };
  const otherLot = holds.find((hold) => isLive(hold.endsOn));
  if (otherLot) return { kind: "refused", message: copy("F-40", { lot: otherLot.lot }) };
  return { kind: "new" };
}
