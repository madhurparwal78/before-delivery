// The one place every domain rule is decided: window status, the conversion
// and pro-rating rule, the ration shares, order transitions, labels.
import {
  decAdd, decCmp, decDiv, decEq, decMul, decParse, decRound3, decStr3, decSub, decTrunc3, decFromInt,
} from "./decimal.ts";
import { windowLabel, truncateToMinute } from "./district-time.ts";

export type WindowStatus = "upcoming" | "open" | "closing" | "closed";

export function windowStatus(opensAt: number, closesAt: number, now: number): WindowStatus {
  if (now < opensAt) return "upcoming";
  if (now >= closesAt) return "closed";
  if (now >= closesAt - 30 * 60000) return "closing";
  return "open";
}

export const STATUS_LABEL: Record<WindowStatus, string> = {
  upcoming: "Not yet open",
  open: "Open",
  closing: "Closing: final 30 minutes",
  closed: "Closed",
};

export function isOrderable(opensAt: number, closesAt: number, now: number): boolean {
  return now >= opensAt - 240 * 3600000 && now < closesAt;
}

export function windowHours(opensAt: number, closesAt: number): number {
  return Math.round((closesAt - opensAt) / 3600000);
}

export type OrderStatus = "requested" | "scheduled" | "running" | "delivered" | "closed";

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  requested: "Requested",
  scheduled: "Scheduled",
  running: "Running",
  delivered: "Delivered",
  closed: "Closed",
};

// --- the conversion rule (one place) -----------------------------------------

export function effectiveCapMlDay(tableCap: string, restrictionCap: string | null): string {
  if (restrictionCap === null) return tableCap;
  return decCmp(decParse(tableCap)!, decParse(restrictionCap)!) <= 0 ? tableCap : restrictionCap;
}

// cap volume, pro-rated when restricted; every value is a 3-decimal string
export function capVolumeMl(
  tableCap: string,
  restrictionCap: string | null,
  restrictionEffectiveAt: number | null,
  opensAt: number,
  hours: number,
): string {
  const cap = decParse(tableCap)!;
  if (restrictionCap === null || restrictionEffectiveAt === null) {
    return decStr3(decRound3(decDiv(decMul(cap, decFromInt(hours)), decFromInt(24), 6)));
  }
  const effAt = Math.max(truncateToMinute(restrictionEffectiveAt), truncateToMinute(opensAt));
  let mBefore = Math.floor((effAt - opensAt) / 60000);
  if (mBefore < 0) mBefore = 0;
  const mAfter = hours * 60 - mBefore;
  const before = decMul(cap, decFromInt(mBefore));
  const after = decMul(decParse(effectiveCapMlDay(tableCap, restrictionCap))!, decFromInt(mAfter));
  return decStr3(decRound3(decDiv(decAdd(before, after), decFromInt(1440), 6)));
}

// a turnout's max volume for a window
export function turnoutMaxMl(maxRateMlDay: string, hours: number): string {
  return decStr3(decRound3(decDiv(decMul(decParse(maxRateMlDay)!, decFromInt(hours)), decFromInt(24), 6)));
}

// an order's rate for a volume in a window
export function rateMlDay(volumeMl: string, hours: number): string {
  return decStr3(decRound3(decDiv(decMul(decParse(volumeMl)!, decFromInt(24)), decFromInt(hours), 6)));
}

export function remainingMl(capVolumeMl: string, committedMl: string): string {
  return decStr3(decSub(decParse(capVolumeMl)!, decParse(committedMl)!));
}

export function label(opensAt: number, closesAt: number): string {
  return windowLabel(opensAt, closesAt);
}

// --- the ration shares (one place) -------------------------------------------

export type RationCandidate = {
  orderNumber: string;
  growerId: number;
  demand: string; // 3-decimal string, >= 0
};

export function rationShares(
  candidates: RationCandidate[],
  remainingMl: string,
): { shares: Map<string, string>; scheduled: string[]; leftRequested: string[] } {
  const R = decParse(remainingMl)!;
  const D = candidates.reduce((acc, c) => decAdd(acc, decParse(c.demand)!), decParse("0")!);
  const shares = new Map<string, string>();
  const scheduled: string[] = [];
  const leftRequested: string[] = [];

  if (decCmp(D, R) <= 0) {
    for (const c of candidates) {
      shares.set(c.orderNumber, c.demand);
      if (!decEq(decParse(c.demand)!, decParse("0.000")!)) scheduled.push(c.orderNumber);
      else leftRequested.push(c.orderNumber);
    }
    return { shares, scheduled, leftRequested };
  }

  const trunced = candidates.map((c) => {
    const raw = decDiv(decMul(decParse(c.demand)!, R), D, 12);
    const trunc = decTrunc3(raw);
    const leftover = decSub(raw, trunc); // discarded remainder
    return { c, trunc, leftover };
  });

  let sum = trunced.reduce((acc, t) => decAdd(acc, t.trunc), decParse("0")!);
  const leftoverThousandths = decSub(R, sum); // scale-3: s counts thousandths
  const extra = Number(leftoverThousandths.s);
  // hand leftover thousandths one each to the largest discarded remainder,
  // ties to the lower order number (candidates arrive in order-number order)
  const byRemainder = [...trunced].sort((a, b) => {
    const cmp = decCmp(b.leftover, a.leftover);
    if (cmp !== 0) return cmp;
    return a.c.orderNumber < b.c.orderNumber ? -1 : 1;
  });
  const bumps = new Map<string, number>();
  let given = 0;
  for (const t of byRemainder) {
    if (given >= extra) break;
    bumps.set(t.c.orderNumber, (bumps.get(t.c.orderNumber) ?? 0) + 1);
    given++;
  }
  for (const t of trunced) {
    const bump = bumps.get(t.c.orderNumber) ?? 0;
    // one bump is one thousandth: a scale-3 unit
    const share = bump > 0 ? decAdd(t.trunc, { s: BigInt(bump), scale: 3 }) : t.trunc;
    const shareStr = decStr3(share);
    shares.set(t.c.orderNumber, shareStr);
    if (shareStr !== "0.000") scheduled.push(t.c.orderNumber);
    else leftRequested.push(t.c.orderNumber);
  }
  return { shares, scheduled, leftRequested };
}
