/** The fit rules: station gaps, axle split, mass, dimensions, road class and power. Integers in tenths, exact rationals. */
import { resolveSceneParts } from '../shared/parts.js';
import type { FitResult, LimitRule, PlateColour, RailResult, RegCountry, RoadClass, StationResult, Units, VerdictCode } from '../shared/types.js';
import {
  AXLE_LIMIT_POINTS, CLASS_POWER_LIMIT_KW_T, CONSUMPTION_WH_PER_KM, CONTROLLER, HUB_STATIONS, MIN_GAP_T, ROAD_CLASS_NAMES, tenthsText,
  type Donor, type Hub, type Pack,
} from './catalogue.js';

export interface Frame {
  plate: string | null;
  regCountry: RegCountry;
  model: Donor;
  firstAdmissionYear: number;
  roadClass: RoadClass;
  plateColour: PlateColour;
  registeredMassT: number;
  confirmed: boolean;
}

export function revisionOf(donor: Donor, year: number): 'A' | 'B' {
  return donor.revisionBFrom !== null && year >= donor.revisionBFrom ? 'B' : 'A';
}

/** Round half up of a non-negative rational. */
function halfUp(numerator: bigint, denominator: bigint): bigint {
  return (2n * numerator + denominator) / (2n * denominator);
}

function lengthText(tenths: number, units: Units): string {
  if (units === 'metric') return `${tenthsText(tenths)} mm`;
  const thousandths = Number(halfUp(BigInt(Math.abs(tenths)) * 1000n, 254n));
  return `${tenths < 0 ? '-' : ''}${Math.floor(thousandths / 1000)}.${String(thousandths % 1000).padStart(3, '0')} in`;
}

function massText(tenths: number, units: Units): string {
  if (units === 'metric') return `${tenthsText(tenths)} kg`;
  const pounds = Number(halfUp(BigInt(tenths) * 100000000n, 45359237n));
  return `${tenthsText(pounds)} lb`;
}

/** Only the pack's length can grow; each pack publishes its growth along its rail. */
const GROWN_DIMENSION = 'length';

const kwText = (tenths: number): string => tenthsText(tenths);

interface Rail {
  part: 'traction-pack' | 'hub-motor';
  partName: string;
  railT: number;
  stations: { id: string; name: string; travelT: number; gapT: number | null }[];
  stopT: number;
  foulingFeature: string | null;
}

function packRail(frame: Frame, pack: Pack): Rail {
  const stationSet = frame.model.packStations[revisionOf(frame.model, frame.firstAdmissionYear)] ?? frame.model.packStations.A;
  const last = stationSet[stationSet.length - 1];
  return reach('traction-pack', 'Traction pack', last.travelT, stationSet.map((s) => ({
    id: s.id, name: s.name, travelT: s.travelT, gapT: Math.min(s.openWidthT - pack.widthT, s.openHeightT - pack.heightT),
  })));
}

function hubRail(frame: Frame, hub: Hub): Rail {
  const gaps = [frame.model.hub.mouthT - hub.widthT, frame.model.hub.armT - hub.widthT, frame.model.hub.sprocketT - hub.shaftT];
  return reach('hub-motor', 'Hub motor', HUB_STATIONS[HUB_STATIONS.length - 1].travelT, HUB_STATIONS.map((s, i) => ({ id: s.id, name: s.name, travelT: s.travelT, gapT: gaps[i] })));
}

/** Walk the stations in order: the first negative gap is contact, and later stations are not reached. */
function reach(part: Rail['part'], partName: string, railT: number, all: { id: string; name: string; travelT: number; gapT: number }[]): Rail {
  const stations: Rail['stations'] = [];
  let stopT = railT;
  let foulingFeature: string | null = null;
  for (const s of all) {
    if (foulingFeature !== null) {
      stations.push({ ...s, gapT: null });
      continue;
    }
    stations.push(s);
    if (s.gapT < 0) {
      stopT = s.travelT;
      foulingFeature = s.name;
    }
  }
  return { part, partName, railT, stations, stopT, foulingFeature };
}

function railResult(rail: Rail): RailResult {
  return {
    railMm: tenthsText(rail.railT),
    stopTravelMm: tenthsText(rail.stopT),
    foulingFeature: rail.foulingFeature,
    stations: rail.stations.map((s): StationResult => ({
      id: s.id, name: s.name, travelMm: tenthsText(s.travelT),
      gapMm: s.gapT === null ? null : tenthsText(s.gapT), passes: s.gapT !== null && s.gapT >= 0,
    })),
  };
}

interface Axle { donorNum: bigint; donorDen: bigint; builtNum: bigint; builtDen: bigint; diffNum: bigint; diffDen: bigint }

function axle(frame: Frame, pack: Pack, hub: Hub): Axle {
  const d = frame.model;
  const wheelbase = BigInt(d.wheelbaseT);
  const big = (n: number): bigint => BigInt(n);
  const donorNum = big(d.chassis.massT) * big(d.chassis.xT) + big(d.engine.massT) * big(d.engine.xT) + big(d.tank.massT) * big(d.tank.xT);
  const donorDen = (big(d.chassis.massT) + big(d.engine.massT) + big(d.tank.massT)) * wheelbase;
  const builtNum = big(d.chassis.massT) * big(d.chassis.xT) + big(pack.massT) * big(d.bayXT) + big(CONTROLLER.massT) * big(CONTROLLER.xT);
  const builtDen = (big(d.chassis.massT) + big(pack.massT) + big(hub.massT) + big(CONTROLLER.massT)) * wheelbase;
  const signed = builtNum * donorDen - donorNum * builtDen;
  return { donorNum, donorDen, builtNum, builtDen, diffNum: signed < 0n ? -signed : signed, diffDen: builtDen * donorDen };
}

const pctText = (num: bigint, den: bigint): string => tenthsText(Number(halfUp(num * 1000n, den)));

function builtMassT(frame: Frame, pack: Pack, hub: Hub): number {
  return frame.model.chassis.massT + pack.massT + hub.massT + CONTROLLER.massT;
}

function rangeKm(pack: Pack, target: RoadClass): number {
  return Math.floor(pack.wh / CONSUMPTION_WH_PER_KM[target]);
}

export function fitResult(frame: Frame, pack: Pack, hub: Hub, target: RoadClass, units: Units): FitResult {
  const rails = [packRail(frame, pack), hubRail(frame, hub)] as const;
  const ax = axle(frame, pack, hub);
  const built = builtMassT(frame, pack, hub);
  const className = ROAD_CLASS_NAMES[frame.regCountry][target];
  const donorKw = frame.model.powerKwT;

  const limits: { rule: LimitRule; passes: boolean; sentence: string | null }[] = [
    {
      rule: 'axle_split', passes: ax.diffNum * 100n <= ax.diffDen * BigInt(AXLE_LIMIT_POINTS), sentence: null,
    },
    { rule: 'road_class_power', passes: hub.kwT <= CLASS_POWER_LIMIT_KW_T[target], sentence: null },
    { rule: 'donor_power', passes: hub.kwT * 10 <= donorKw * 12, sentence: null },
    { rule: 'registered_mass', passes: built <= frame.registeredMassT, sentence: null },
    { rule: 'overall_dimensions', passes: pack.growthT === 0, sentence: null },
  ];
  const sentences: Record<LimitRule, string> = {
    axle_split: `Axle split moves ${pctText(ax.diffNum, ax.diffDen)} points; the limit is ${tenthsText(AXLE_LIMIT_POINTS * 10)}.`,
    road_class_power: `Hub power ${kwText(hub.kwT)} kW is over the ${className} limit of ${kwText(CLASS_POWER_LIMIT_KW_T[target])} kW.`,
    donor_power: `Hub power ${kwText(hub.kwT)} kW is over 120 percent of the donor's ${kwText(donorKw)} kW.`,
    registered_mass: `Built mass ${massText(built, units)} is over the registered ${massText(frame.registeredMassT, units)}.`,
    overall_dimensions: `The kit grows the overall ${GROWN_DIMENSION} by ${lengthText(pack.growthT, units)}.`,
  };
  for (const limit of limits) limit.sentence = limit.passes ? null : sentences[limit.rule];

  let verdict: VerdictCode;
  let word: string;
  let sentence: string;
  const fouling = rails.find((r) => r.foulingFeature !== null);
  const tight = rails.flatMap((r) => r.stations).find((s) => s.gapT !== null && s.gapT >= 0 && s.gapT < MIN_GAP_T);
  const broken = limits.find((l) => !l.passes);
  if (fouling) {
    verdict = 'fouls';
    word = 'Fouls';
    sentence = `Fouls. ${fouling.partName} stops at ${lengthText(fouling.stopT, units)} on ${fouling.foulingFeature}.`;
  } else if (tight) {
    verdict = 'too_tight';
    word = 'Too tight';
    sentence = `Too tight. Gap ${lengthText(tight.gapT!, units)} at ${tight.name}; the minimum is ${lengthText(MIN_GAP_T, units)}.`;
  } else if (broken) {
    verdict = 'outside_limits';
    word = 'Outside limits';
    sentence = `Outside limits. ${broken.sentence}`;
  } else {
    verdict = 'fits';
    word = 'Fits';
    const reached = rails.flatMap((r) => r.stations.flatMap((s) => (s.gapT === null ? [] : [{ name: s.name, gapT: s.gapT }])));
    const smallest = reached.reduce((least, s) => (s.gapT < least.gapT ? s : least));
    sentence = `Fits. Smallest gap ${lengthText(smallest.gapT, units)} at ${smallest.name}.`;
  }
  if (!frame.confirmed) sentence += ' Donor unconfirmed.';

  return {
    verdict, word, sentence, confirmed: frame.confirmed, revision: revisionOf(frame.model, frame.firstAdmissionYear),
    rails: { pack: railResult(rails[0]), hub: railResult(rails[1]) },
    axle: { donorFrontPct: pctText(ax.donorNum, ax.donorDen), builtFrontPct: pctText(ax.builtNum, ax.builtDen), shiftPct: pctText(ax.diffNum, ax.diffDen), passes: limits[0].passes },
    builtMassKg: tenthsText(built),
    rangeKm: rangeKm(pack, target),
    limits,
    parts: resolveSceneParts({
      wheelbaseMm: frame.model.wheelbaseT / 10, bayXMm: frame.model.bayXT / 10, mouthWidthMm: frame.model.hub.mouthT / 10,
      pack: { widthMm: pack.widthT / 10, heightMm: pack.heightT / 10, growthLengthMm: pack.growthT / 10 }, hub: { widthMm: hub.widthT / 10 },
    }),
  };
}
