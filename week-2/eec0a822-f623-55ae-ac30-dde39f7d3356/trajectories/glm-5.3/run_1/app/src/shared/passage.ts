import { Decimal, roundHalfUp } from './decimal.js';
import { type Base, localParts, WEEKDAYS, MONTHS, instant, type Instant, addSeconds, diffSeconds } from '../shared/bases.js';

export interface Anchorage {
  id: string;
  name: string;
  base: Base;
  latitude: string;
  longitude: string;
}

export interface LegInput {
  toAnchorageId: string;
  speedKn: string;
}

export interface LegComputed {
  index: number;
  fromAnchorageId: string;
  toAnchorageId: string;
  speedKn: string;
  distanceNm: string;
  departsAt: string;
  arrivesAt: string;
  arrivalBase: Base;
  arrivalChargePct: number;
  reserve: 'ok' | 'below_reserve';
}

export interface PassageComputed {
  legs: LegComputed[];
  minChargePct: number | null;
}

const EARTH_RADIUS_NM = '3440.065';

/** Haversine distance on a sphere of radius 3440.065 nm, full precision. */
export function haversineNm(a: Anchorage, b: Anchorage): Decimal {
  const toRad = (d: string) => new Decimal(d).times(Decimal.acos(-1)).dividedBy(180);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const dLat = lat2.minus(lat1);
  const dLon = toRad(b.longitude).minus(toRad(a.longitude));
  const sinDLat = dLat.dividedBy(2).sin();
  const sinDLon = dLon.dividedBy(2).sin();
  const hRaw = sinDLat.times(sinDLat).plus(lat1.cos().times(lat2.cos()).times(sinDLon).times(sinDLon));
  const h = hRaw.greaterThan(1) ? new Decimal(1) : hRaw.lessThan(0) ? new Decimal(0) : hRaw;
  // distance = 2R·asin(√h); asin(s) = 2·atan(s/(1+√(1-h)))
  const one = new Decimal(1);
  const s = h.sqrt();
  const root = one.minus(h).sqrt();
  const asinS = s.dividedBy(one.plus(root)).atan().times(2);
  return asinS.times(EARTH_RADIUS_NM);
}

export interface EnergyParams {
  batteryKwh: string;
  hotelKw: string;
  solarKw: string;
  dragKwPerKnCubed: string;
}

export interface PassageGeometry {
  anchorages: Map<string, Anchorage>;
  startAnchorageId: string;
  startChargePct: number;
  departsAt: Instant;
  params: EnergyParams;
}

/**
 * The passage energy rule. Computes every leg's distance, arrival time,
 * arrival charge and reserve state.
 */
export function computePassage(geo: PassageGeometry, legsIn: LegInput[]): PassageComputed {
  const legs: LegComputed[] = [];
  const battery = new Decimal(geo.params.batteryKwh);
  let chargeKwh = battery.times(geo.startChargePct).dividedBy(100);
  let prev: Anchorage = geo.anchorages.get(geo.startAnchorageId)!;
  let departs = geo.departsAt;
  let minCharge: number | null = null;
  legsIn.forEach((leg, i) => {
    const to = geo.anchorages.get(leg.toAnchorageId)!;
    const speed = new Decimal(leg.speedKn);
    const distance = haversineNm(prev, to);
    const hours = distance.dividedBy(speed);
    const netDraw = new Decimal(geo.params.dragKwPerKnCubed).times(speed.pow(3)).plus(geo.params.hotelKw).minus(geo.params.solarKw);
    const after = chargeKwh.minus(netDraw.times(hours));
    const clamped = after.greaterThan(battery) ? battery : after.lessThan(0) ? new Decimal(0) : after;
    const pctExact = clamped.dividedBy(battery).times(100);
    const pctSix = roundHalfUp(pctExact, 6);
    const pct = Math.floor(pctSix.toNumber());
    const seconds = Math.round(hours.times(3600).toNumber());
    const arrivesAt = addSeconds(departs, seconds);
    legs.push({
      index: i,
      fromAnchorageId: prev.id,
      toAnchorageId: to.id,
      speedKn: leg.speedKn,
      distanceNm: roundHalfUp(distance, 2).toFixed(2),
      departsAt: instantToIso(departs),
      arrivesAt: instantToIso(arrivesAt),
      arrivalBase: to.base,
      arrivalChargePct: pct,
      reserve: pct < 20 ? 'below_reserve' : 'ok',
    });
    if (minCharge === null || pct < minCharge) minCharge = pct;
    chargeKwh = clamped;
    prev = to;
    departs = arrivesAt;
  });
  return { legs, minChargePct: legs.length === 0 ? null : minCharge };
}

export function instantToIso(i: Instant): string {
  return new Date(i.ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Arrival time in the arrival anchorage's base time for display. */
export function fmtBaseDateTime(base: Base, i: Instant): string {
  const p = localParts(base, i);
  const name = base === 'split' ? 'Split' : 'Lavrio';
  return `${WEEKDAYS[p.weekday]} ${p.day} ${MONTHS[p.month - 1]} ${p.year}, ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')} ${name} time`;
}

export { instant, addSeconds, diffSeconds };
