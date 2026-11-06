import {
  DONORS, PACK_STATIONS, HUB_STATIONS, HUB_GEOMETRY, PACKS, HUBS,
  MIN_CLEARANCE_MM, RANGE_CONSUMPTION_WH_PER_KM, CLASS_LIMITS_KW, classNameFor,
} from './seed.js';
import type { Units } from './units.js';
import { formatLength, formatMass } from './units.js';

// Geometry and fit decisions: one place decides every verdict.
// All lengths are integer tenths of a millimetre; the axle comparison is exact.

export type Verdict = 'fits' | 'too_tight' | 'fouls' | 'outside_limits';
export type RailPart = 'traction-pack' | 'hub-motor';

export interface RailStation {
  id: string;
  name: string;
  travelMm: number;
  gapMm: number | null;
  passes: boolean;
}

export interface RailResult {
  part: RailPart;
  railMm: number;
  stopTravelMm: number;
  foulingFeature: string | null;
  stations: RailStation[];
}

export interface FitDonor {
  model: string;
  country: string;
  firstAdmissionYear: number;
  roadClass: 25 | 45;
  plateColour: string;
  registeredMassKg: number; // tenths
}

export interface FitInput {
  donor: FitDonor;
  packId: string;
  hubId: string;
  roadClass: 25 | 45;
  units: Units;
}

export interface FitResult {
  verdict: Verdict;
  word: string;
  sentence: string;
  confirmed: boolean;
  revision: 'A' | 'B';
  rails: { pack: RailResult; hub: RailResult };
  axle: { donorFrontPct: string; builtFrontPct: string; shiftPct: string; passes: boolean };
  builtMassKg: string;
  rangeKm: number;
  limits: { rule: string; passes: boolean; sentence: string | null }[];
}

export function revisionForYear(model: string, year: number): 'A' | 'B' {
  if (model === 'K50' && year >= 2021) return 'B';
  return 'A';
}

const PART_NAMES: Record<RailPart, string> = { 'traction-pack': 'Traction pack', 'hub-motor': 'Hub motor' };

function packRail(model: string, revision: 'A' | 'B', packId: string): RailResult {
  const pack = PACKS.find((p) => p.id === packId)!;
  const table = PACK_STATIONS.find((s) => s.model === model && s.revision === revision)!;
  const railMm = table.stations[table.stations.length - 1]!.travelMm;
  const stations: RailStation[] = [];
  let foulingFeature: string | null = null;
  let stopTravel = railMm;
  for (const st of table.stations) {
    if (foulingFeature !== null) {
      stations.push({ id: st.id, name: st.name, travelMm: st.travelMm, gapMm: null, passes: false });
      continue;
    }
    const gap = Math.min(st.widthMm - pack.widthMm, st.heightMm - pack.heightMm);
    if (gap < 0) {
      foulingFeature = st.name;
      stopTravel = st.travelMm;
      stations.push({ id: st.id, name: st.name, travelMm: st.travelMm, gapMm: gap, passes: false });
      continue;
    }
    stations.push({ id: st.id, name: st.name, travelMm: st.travelMm, gapMm: gap, passes: gap >= MIN_CLEARANCE_MM });
  }
  return { part: 'traction-pack', railMm, stopTravelMm: stopTravel, foulingFeature, stations };
}

function hubRail(model: string, hubId: string): RailResult {
  const hub = HUBS.find((h) => h.id === hubId)!;
  const geo = HUB_GEOMETRY[model]!;
  const railMm = HUB_STATIONS[HUB_STATIONS.length - 1]!.travelMm;
  const defs = [
    { id: 'H1', name: 'Swingarm mouth', travelMm: 200, gap: geo.mouthWidthMm - hub.widthMm },
    { id: 'H2', name: 'Swingarm arm', travelMm: 450, gap: geo.armWidthMm - hub.widthMm },
    { id: 'H3', name: 'Sprocket line', travelMm: 700, gap: geo.sprocketLineMm - hub.shaftMm },
  ];
  const stations: RailStation[] = [];
  let foulingFeature: string | null = null;
  let stopTravel = railMm;
  for (const st of defs) {
    if (foulingFeature !== null) {
      stations.push({ id: st.id, name: st.name, travelMm: st.travelMm, gapMm: null, passes: false });
      continue;
    }
    if (st.gap < 0) {
      foulingFeature = st.name;
      stopTravel = st.travelMm;
      stations.push({ id: st.id, name: st.name, travelMm: st.travelMm, gapMm: st.gap, passes: false });
      continue;
    }
    stations.push({ id: st.id, name: st.name, travelMm: st.travelMm, gapMm: st.gap, passes: st.gap >= MIN_CLEARANCE_MM });
  }
  return { part: 'hub-motor', railMm, stopTravelMm: stopTravel, foulingFeature, stations };
}

// Exact axle split with integer cross-multiplication.
function axleSplit(model: string, packId: string, hubId: string): { donorPct: number; builtPct: number; passes: boolean; shiftPct: number } {
  const donor = DONORS.find((d) => d.id === model)!;
  const pack = PACKS.find((p) => p.id === packId)!;
  const hub = HUBS.find((h) => h.id === hubId)!;
  const ctrlMass = 20;
  const donorMass = donor.chassisMassKg + donor.engineMassKg + donor.fuelTankMassKg;
  const donorMoment = donor.chassisMassKg * donor.chassisXmm + donor.engineMassKg * donor.engineXmm + donor.fuelTankMassKg * donor.fuelTankXmm;
  const builtMass = donor.chassisMassKg + pack.massKg + hub.massKg + ctrlMass;
  const builtMoment = donor.chassisMassKg * donor.chassisXmm + pack.massKg * donor.bayXmm + ctrlMass * 6400;
  // |builtFront - donorFront| <= 10 points, with front share = moment/(mass*wheelbase):
  // |builtMoment/builtMass - donorMoment/donorMass| <= wheelbase/10.
  const diffNum = BigInt(builtMoment) * BigInt(donorMass) - BigInt(donorMoment) * BigInt(builtMass);
  const diffNumAbs = diffNum < 0n ? -diffNum : diffNum;
  const rhs = BigInt(builtMass) * BigInt(donorMass) * BigInt(donor.wheelbaseMm) * 10n;
  const passes = diffNumAbs * 100n <= rhs;
  // shift in percentage points, one decimal: |diff| / wheelbase * 100
  const diffDen = BigInt(builtMass) * BigInt(donorMass) * BigInt(donor.wheelbaseMm);
  // times 100 with half-up at one decimal: compute (diffNumAbs * 1000 * 100) / diffDen then round
  const scaled = (diffNumAbs * 100000n + diffDen / 2n) / diffDen;
  const shiftPct = Number(scaled) / 10;
  const donorPct = (donorMoment / (donorMass * donor.wheelbaseMm)) * 100;
  const builtPct = (builtMoment / (builtMass * donor.wheelbaseMm)) * 100;
  return { donorPct, builtPct, passes, shiftPct };
}

export function runFitCheck(input: FitInput, confirmed: boolean): FitResult {
  const model = input.donor.model;
  const revision = revisionForYear(model, input.donor.firstAdmissionYear);
  const pack = PACKS.find((p) => p.id === input.packId)!;
  const hub = HUBS.find((h) => h.id === input.hubId)!;
  const packRes = packRail(model, revision, input.packId);
  const hubRes = hubRail(model, input.hubId);
  const axle = axleSplit(model, input.packId, input.hubId);
  const units = input.units;
  const u = (tenths: number) => formatLength(tenths / 10, units);

  const stationsInOrder = [
    ...packRes.stations.map((s) => ({ s, rail: packRes })),
    ...hubRes.stations.map((s) => ({ s, rail: hubRes })),
  ];

  const limits: { rule: string; passes: boolean; sentence: string | null }[] = [];
  const donor = DONORS.find((d) => d.id === model)!;
  limits.push({
    rule: 'axle_split',
    passes: axle.passes,
    sentence: axle.passes ? null : `Axle split moves ${axle.shiftPct.toFixed(1)} points; the limit is 10.0.`,
  });
  const classLimit = CLASS_LIMITS_KW[input.roadClass];
  const classPasses = hub.kwTenths <= classLimit;
  const targetClassName = classNameFor(input.donor.country, input.roadClass);
  limits.push({
    rule: 'road_class_power',
    passes: classPasses,
    sentence: classPasses ? null : `Hub power ${(hub.kwTenths / 10).toFixed(1)} kW is over the ${targetClassName} limit of ${(classLimit / 10).toFixed(1)} kW.`,
  });
  const donorPowerPasses = hub.kwTenths * 10 <= donor.powerKwTenths * 12;
  limits.push({
    rule: 'donor_power',
    passes: donorPowerPasses,
    sentence: donorPowerPasses ? null : `Hub power ${(hub.kwTenths / 10).toFixed(1)} kW is over 120 percent of the donor's ${(donor.powerKwTenths / 10).toFixed(1)} kW.`,
  });
  const ctrlMass = 20;
  const builtMassTenths = donor.chassisMassKg + pack.massKg + hub.massKg + ctrlMass;
  const massPasses = builtMassTenths <= input.donor.registeredMassKg;
  limits.push({
    rule: 'registered_mass',
    passes: massPasses,
    sentence: massPasses ? null : `Built mass ${formatMass(builtMassTenths / 10, units)} is over the registered ${formatMass(input.donor.registeredMassKg / 10, units)}.`,
  });
  limits.push({
    rule: 'overall_dimensions',
    passes: pack.growth === null,
    sentence: pack.growth === null ? null : `The kit grows the overall ${pack.growth.dimension} by ${u(pack.growth.mm)}.`,
  });

  let verdict: Verdict = 'fits';
  let sentence = '';
  const fouling = stationsInOrder.find((x) => x.s.gapMm !== null && x.s.gapMm < 0);
  const tight = stationsInOrder.find((x) => x.s.gapMm !== null && x.s.gapMm >= 0 && x.s.gapMm < MIN_CLEARANCE_MM);

  if (fouling) {
    verdict = 'fouls';
    sentence = `Fouls. ${PART_NAMES[fouling.rail.part]} stops at ${u(fouling.rail.stopTravelMm)} on ${fouling.s.name}.`;
  } else if (tight) {
    verdict = 'too_tight';
    sentence = `Too tight. Gap ${u(tight.s.gapMm!)} at ${tight.s.name}; the minimum is ${u(MIN_CLEARANCE_MM)}.`;
  } else {
    const failed = limits.find((l) => !l.passes);
    if (failed) {
      verdict = 'outside_limits';
      sentence = `Outside limits. ${failed.sentence}`;
    } else {
      const smallest = smallestGap(packRes, hubRes);
      sentence = `Fits. Smallest gap ${u(smallest.gap)} at ${smallest.station.name}.`;
    }
  }

  const consumption = RANGE_CONSUMPTION_WH_PER_KM[input.roadClass];
  const rangeKm = Math.floor(pack.wh / consumption);
  const words: Record<Verdict, string> = { fits: 'Fits', too_tight: 'Too tight', fouls: 'Fouls', outside_limits: 'Outside limits' };

  return {
    verdict,
    word: words[verdict],
    sentence,
    confirmed,
    revision,
    rails: { pack: packRes, hub: hubRes },
    axle: {
      donorFrontPct: axle.donorPct.toFixed(1),
      builtFrontPct: axle.builtPct.toFixed(1),
      shiftPct: axle.shiftPct.toFixed(1),
      passes: axle.passes,
    },
    builtMassKg: (builtMassTenths / 10).toFixed(1),
    rangeKm,
    limits,
  };
}

export function smallestGap(packRes: RailResult, hubRes: RailResult): { gap: number; station: RailStation } {
  const candidates: { gap: number; station: RailStation }[] = [];
  for (const s of packRes.stations) if (s.gapMm !== null && s.gapMm >= 0) candidates.push({ gap: s.gapMm, station: s });
  for (const s of hubRes.stations) if (s.gapMm !== null && s.gapMm >= 0) candidates.push({ gap: s.gapMm, station: s });
  let best = candidates[0]!;
  for (const c of candidates) if (c.gap < best.gap) best = c;
  return best;
}
