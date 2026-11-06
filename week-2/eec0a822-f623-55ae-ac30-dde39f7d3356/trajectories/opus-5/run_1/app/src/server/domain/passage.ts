import type { BaseKey } from '../../shared/format.js';

export const EARTH_RADIUS_NM = 3440.065;
export const RESERVE_PCT = 20;
export const MAX_LEGS = 12;
export const MIN_SPEED_KN = 4;
export const MAX_SPEED_KN = 12;

export interface AnchoragePoint {
  readonly id: string;
  readonly name: string;
  readonly base: BaseKey;
  readonly latitude: number;
  readonly longitude: number;
}

export interface YachtEnergy {
  readonly batteryKwh: number;
  readonly hotelKw: number;
  readonly solarKw: number;
  readonly dragKwPerKnCubed: number;
}

export interface LegInput {
  readonly toAnchorageId: string;
  readonly speedKn: number;
}

export interface ComputedLeg {
  readonly index: number;
  readonly fromAnchorageId: string;
  readonly toAnchorageId: string;
  readonly speedKn: number;
  readonly distanceNm: number;
  readonly departsAt: Date;
  readonly arrivesAt: Date;
  readonly arrivalBase: BaseKey;
  readonly arrivalChargePct: number;
  readonly reserve: 'ok' | 'below_reserve';
}

export function haversineNm(from: AnchoragePoint, to: AnchoragePoint): number {
  const toRadians = Math.PI / 180;
  const latitude1 = from.latitude * toRadians;
  const latitude2 = to.latitude * toRadians;
  const deltaLatitude = latitude2 - latitude1;
  const deltaLongitude = (to.longitude - from.longitude) * toRadians;
  const haversine =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(deltaLongitude / 2) ** 2;
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

export function netDrawKw(yacht: YachtEnergy, speedKn: number): number {
  return yacht.dragKwPerKnCubed * speedKn ** 3 + yacht.hotelKw - yacht.solarKw;
}

export function chargePctOf(chargeKwh: number, batteryKwh: number): number {
  const exact = (chargeKwh / batteryKwh) * 100;
  const sixDecimals = Math.round(exact * 1_000_000) / 1_000_000;
  return Math.floor(sixDecimals);
}

/** The one passage energy rule: distances, arrival instants and arrival charges. */
export function computeLegs(options: {
  readonly yacht: YachtEnergy;
  readonly anchorages: ReadonlyMap<string, AnchoragePoint>;
  readonly startAnchorageId: string;
  readonly departsAt: Date;
  readonly startChargePct: number;
  readonly legs: readonly LegInput[];
}): ComputedLeg[] {
  const { yacht, anchorages } = options;
  let fromId = options.startAnchorageId;
  let departsAt = options.departsAt;
  let chargeKwh = (options.startChargePct / 100) * yacht.batteryKwh;
  const computed: ComputedLeg[] = [];
  for (const [index, leg] of options.legs.entries()) {
    const from = anchorages.get(fromId);
    const to = anchorages.get(leg.toAnchorageId);
    if (from === undefined || to === undefined) throw new Error('Unknown anchorage in passage');
    const distanceNm = haversineNm(from, to);
    const hours = distanceNm / leg.speedKn;
    chargeKwh = Math.min(
      yacht.batteryKwh,
      Math.max(0, chargeKwh - netDrawKw(yacht, leg.speedKn) * hours),
    );
    const arrivesAt = new Date(Math.round((departsAt.getTime() + hours * 3_600_000) / 1000) * 1000);
    const arrivalChargePct = chargePctOf(chargeKwh, yacht.batteryKwh);
    computed.push({
      index,
      fromAnchorageId: fromId,
      toAnchorageId: leg.toAnchorageId,
      speedKn: leg.speedKn,
      distanceNm,
      departsAt,
      arrivesAt,
      arrivalBase: to.base,
      arrivalChargePct,
      reserve: arrivalChargePct < RESERVE_PCT ? 'below_reserve' : 'ok',
    });
    fromId = leg.toAnchorageId;
    departsAt = arrivesAt;
  }
  return computed;
}

export function minChargePct(legs: readonly ComputedLeg[]): number | null {
  if (legs.length === 0) return null;
  return legs.reduce((lowest, leg) => Math.min(lowest, leg.arrivalChargePct), 100);
}

export function isValidSpeed(speedKn: number): boolean {
  if (!Number.isFinite(speedKn)) return false;
  const halves = speedKn * 2;
  return (
    Number.isInteger(Math.round(halves * 1000) / 1000) &&
    Math.abs(halves - Math.round(halves)) < 1e-9 &&
    speedKn >= MIN_SPEED_KN &&
    speedKn <= MAX_SPEED_KN
  );
}

export function roundTwoDecimals(value: number): number {
  return Math.round(value * 100 + 1e-9) / 100;
}
