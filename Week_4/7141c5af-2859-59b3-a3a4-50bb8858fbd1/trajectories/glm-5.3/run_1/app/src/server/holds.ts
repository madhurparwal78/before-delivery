import { apiMessages } from "./copy.js";
import { decParse, decCmp, decToString } from "./decimal.js";
import type { LotSpec } from "./estimate.js";

export type HoldRow = { id: string; hold_id: string; code: string; lot: string; quantity: string; unit: string; state: "held" | "ended"; ends_on: string };
export type HoldOutcome =
  | { ok: true; hold: HoldRow }
  | { ok: false; status: number; code: string; message: string };

const lotLabel = (l: LotSpec) => (l.metres !== undefined ? `${l.metres} m` : `${l.hides} hide${l.hides === 1 ? "" : "s"}`);

/** Decide a hold request in the published order, without calling the supplier for any refusal. */
export function decideHold(
  code: string,
  materialName: string,
  materialUnit: string,
  lot: string,
  quantity: string,
  existingHolds: HoldRow[],
  lots: LotSpec[]
): HoldOutcome | { ok: "call" } {
  const chosen = existingHolds.find((h) => h.code === code && h.lot === lot);
  if (chosen) {
    if (chosen.state === "ended") return { ok: false, status: 409, code: "F-34", message: apiMessages.holdEnded(chosen.ends_on) };
    if (chosen.quantity === quantity) return { ok: true, hold: chosen };
    return { ok: false, status: 409, code: "F-41", message: apiMessages.sameLotOtherQty.replace("<q>", quantityLabel(chosen.quantity, materialUnit)) };
  }
  const anyLive = existingHolds.find((h) => h.state === "held" && h.code === code);
  if (anyLive) {
    return { ok: false, status: 409, code: "F-40", message: apiMessages.otherLotHeld.replace("<lot>", anyLive.lot) };
  }
  const requested = parseQuantity(quantity, materialUnit);
  if (requested === null) return { ok: false, status: 422, code: "F-112", message: apiMessages.notANumber };
  const unitLots = lots;
  if (materialUnit === "sqFt") {
    const enough = unitLots.filter((l) => (l.hides ?? 0) >= requested);
    if (enough.length === 0) {
      const largest = Math.max(...unitLots.map((l) => l.hides ?? 0));
      return {
        ok: false, status: 409, code: "F-37",
        message: apiMessages.lotTooSmallLeather.replace("<n>", String(requested)).replace("<name>", materialName).replace("<m>", String(largest)),
      };
    }
    const wanted = unitLots.find((l) => l.lot === lot);
    if (!wanted) return { ok: false, status: 409, code: "F-37", message: apiMessages.lotTooSmallLeather.replace("<n>", String(requested)).replace("<name>", materialName).replace("<m>", "0") };
    if ((wanted.hides ?? 0) < requested) {
      return { ok: false, status: 409, code: "F-39", message: apiMessages.chosenLotTooSmall.replace("<lot>", wanted.lot).replace("<m>", lotLabel(wanted)) };
    }
  } else {
    const q = decParse(quantity);
    if (q === null) return { ok: false, status: 422, code: "F-112", message: apiMessages.notANumber };
    const enough = unitLots.filter((l) => l.metres !== undefined && decCmp(decParse(l.metres)!, q) >= 0);
    if (enough.length === 0) {
      const largest = unitLots.reduce((m, l) => (l.metres !== undefined && decCmp(decParse(l.metres)!, m) > 0 ? decParse(l.metres)! : m), decParse("0")!);
      return {
        ok: false, status: 409, code: "F-38",
        message: apiMessages.lotTooSmallFabric.replace("<n>", quantity).replace("<name>", materialName).replace("<m>", decToString(largest, 2)),
      };
    }
    const wanted = unitLots.find((l) => l.lot === lot);
    if (!wanted || wanted.metres === undefined || decCmp(decParse(wanted.metres)!, q) < 0) {
      return { ok: false, status: 409, code: "F-39", message: apiMessages.chosenLotTooSmall.replace("<lot>", lot).replace("<m>", wanted?.metres ? `${wanted.metres} m` : "0.00 m") };
    }
  }
  return { ok: "call" };
}

export function quantityLabel(quantity: string, unit: string): string {
  if (unit === "metre") return `${quantity} m`;
  const n = Number(quantity);
  return `${n} hide${n === 1 ? "" : "s"}`;
}

function parseQuantity(quantity: string, unit: string): number | null {
  if (unit === "metre") {
    const d = decParse(quantity);
    return d === null ? null : 0;
  }
  if (!/^\d+$/.test(quantity)) return null;
  return Number(quantity);
}
