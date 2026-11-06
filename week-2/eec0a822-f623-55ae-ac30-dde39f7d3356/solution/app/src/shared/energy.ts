// The passage energy rule (brief: Business rules). The server and the planner screen both call this one
// function, so the figures on screen are exactly what the server returns for the same inputs.
import { roundDecimalText, plainDecimal } from "./money";
import type { Base } from "./zones";

const EARTH_RADIUS_NM = 3440.065;
export const RESERVE_PCT = 20;
export const SPEED_MIN = 4;
export const SPEED_MAX = 12;
export const SPEED_STEP = 0.5;
export const SPEED_PAGE = 2;
export const NEW_LEG_SPEED = 6;
export const MAX_LEGS = 12;

export interface Anchorage {
  id: string;
  name: string;
  base: Base;
  latitude: number;
  longitude: number;
}

export interface EnergyProfile {
  batteryKwh: number;
  hotelKw: number;
  solarKw: number;
  dragKwPerKnCubed: number;
}

export interface LegInput {
  toAnchorageId: string;
  speedKn: number;
}

export interface PlannedLeg {
  index: number;
  fromAnchorageId: string;
  toAnchorageId: string;
  speedKn: number;
  distanceNm: number;
  departsAtMs: number;
  arrivesAtMs: number;
  arrivalBase: Base;
  arrivalChargePct: number;
  reserve: "ok" | "below_reserve";
}

function distanceNm(from: Anchorage, to: Anchorage): number {
  const rad = Math.PI / 180;
  const la1 = from.latitude * rad;
  const lo1 = from.longitude * rad;
  const la2 = to.latitude * rad;
  const lo2 = to.longitude * rad;
  const h = Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2;
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.sqrt(h));
}

export function planPassage(
  yacht: EnergyProfile,
  anchorages: ReadonlyMap<string, Anchorage>,
  startAnchorageId: string,
  legs: readonly LegInput[],
  startChargePct: number,
  departsAtMs: number,
): PlannedLeg[] {
  const battery = yacht.batteryKwh;
  let charge = (startChargePct / 100) * battery;
  let at = departsAtMs;
  let here = startAnchorageId;
  return legs.map((leg, index) => {
    const from = anchorages.get(here);
    const to = anchorages.get(leg.toAnchorageId);
    if (!from || !to) throw new RangeError("unknown anchorage");
    const distance = distanceNm(from, to);
    const hours = distance / leg.speedKn;
    const draw = yacht.dragKwPerKnCubed * leg.speedKn ** 3 + yacht.hotelKw - yacht.solarKw;
    charge = Math.min(Math.max(charge - draw * hours, 0), battery);
    const pct = Math.floor(Number(((charge / battery) * 100).toFixed(6)));
    const arrives = at + Math.round(hours * 3600) * 1000;
    const planned: PlannedLeg = {
      index,
      fromAnchorageId: here,
      toAnchorageId: leg.toAnchorageId,
      speedKn: leg.speedKn,
      distanceNm: distance,
      departsAtMs: at,
      arrivesAtMs: arrives,
      arrivalBase: to.base,
      arrivalChargePct: pct,
      reserve: pct < RESERVE_PCT ? "below_reserve" : "ok",
    };
    at = arrives;
    here = leg.toAnchorageId;
    return planned;
  });
}

/** The API's distance: half up to two decimals on the full-precision value. */
export function apiDistance(nm: number): number {
  return Number(roundDecimalText(plainDecimal(nm), 2));
}

export function clampSpeed(kn: number): number {
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, kn));
}

export function isValidSpeed(kn: unknown): kn is number {
  return typeof kn === "number" && Number.isFinite(kn) && kn >= SPEED_MIN && kn <= SPEED_MAX && Number.isInteger(kn * 2);
}
