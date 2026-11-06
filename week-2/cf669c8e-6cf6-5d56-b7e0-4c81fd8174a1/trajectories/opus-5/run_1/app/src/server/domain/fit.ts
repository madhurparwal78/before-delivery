/**
 * The fit engine: the single place a verdict is decided.
 *
 * Every comparison here is between integers in tenths of a millimetre, tenths
 * of a kilogram or tenths of a kilowatt. Display strings are derived at the
 * end and never fed back into a comparison.
 *
 * Fields named `*Mm` and `*Kg` are always millimetres and kilograms whatever
 * the units setting; only the verdict sentence follows the chosen units.
 */

import {
  AXLE_SHIFT_LIMIT_TENTHS_PCT,
  CLASS_POWER_LIMIT_TENTHS_KW,
  CONSUMPTION_WH_PER_KM,
  CONTROLLER,
  DONOR_POWER_LIMIT_PCT,
  HUB_STATION_TRAVELS,
  MIN_CLEARANCE_TENTHS_MM,
  ROAD_CLASS_NAMES,
  donorByModel,
  frameRevision,
  hubById,
  hubFrameByModel,
  packById,
  scenePartById,
} from '../../shared/seed.js';
import {
  formatLength,
  formatMass,
  tenthsKwToString,
  tenthsMmToMmString,
  tenthsPctToString,
  tenthsToOneDecimalString,
} from '../../shared/format.js';
import type {
  AxleResult,
  FitResult,
  LimitResult,
  RailResult,
  ResolvedDonor,
  RoadClass,
  StationResult,
  Units,
  Verdict,
} from '../../shared/types.js';

const PACK_PART_NAME = scenePartById('traction-pack')?.name ?? 'Traction pack';
const HUB_PART_NAME = scenePartById('hub-motor')?.name ?? 'Hub motor';

interface StationGap {
  id: string;
  name: string;
  travelTenthsMm: number;
  gapTenthsMm: number;
}

interface RailAnalysis {
  railTenthsMm: number;
  stopTravelTenthsMm: number;
  /** The first station the part cannot pass, if any. */
  contactAt: StationGap | null;
  /** Stations up to and including the stop. Later stations are never reached. */
  reached: StationGap[];
  all: StationGap[];
}

function analyseRail(stations: readonly StationGap[], railTenthsMm: number): RailAnalysis {
  const reached: StationGap[] = [];
  for (const station of stations) {
    reached.push(station);
    // A negative gap is contact. A gap of exactly 0 is not contact.
    if (station.gapTenthsMm < 0) {
      return {
        railTenthsMm,
        stopTravelTenthsMm: station.travelTenthsMm,
        contactAt: station,
        reached,
        all: [...stations],
      };
    }
  }
  return { railTenthsMm, stopTravelTenthsMm: railTenthsMm, contactAt: null, reached, all: [...stations] };
}

/** The pack gap at a station is the smaller of the width and height clearances. */
function packStationGaps(donor: ResolvedDonor, packId: string): StationGap[] {
  const pack = packById(packId);
  const revision = frameRevision(donor.model, donor.revision);
  if (!pack || !revision) throw new Error(`unknown pack ${packId} or frame ${donor.model}`);
  return revision.stations.map((station) => ({
    id: station.id,
    name: station.name,
    travelTenthsMm: station.travelTenthsMm,
    gapTenthsMm: Math.min(
      station.openWidthTenthsMm - pack.widthTenthsMm,
      station.openHeightTenthsMm - pack.heightTenthsMm,
    ),
  }));
}

/**
 * H1 is swingarm mouth width minus hub width, H2 swingarm arm width minus hub
 * width, and H3 sprocket line minus shaft length.
 */
function hubStationGaps(donor: ResolvedDonor, hubId: string): StationGap[] {
  const hub = hubById(hubId);
  const frame = hubFrameByModel(donor.model);
  if (!hub || !frame) throw new Error(`unknown hub ${hubId} or frame ${donor.model}`);
  const clearances = [
    frame.mouthWidthTenthsMm - hub.widthTenthsMm,
    frame.armWidthTenthsMm - hub.widthTenthsMm,
    frame.sprocketLineTenthsMm - hub.shaftTenthsMm,
  ];
  return HUB_STATION_TRAVELS.map((station, index) => ({
    id: station.id,
    name: station.name,
    travelTenthsMm: station.travelTenthsMm,
    gapTenthsMm: clearances[index] as number,
  }));
}

function railResult(analysis: RailAnalysis): RailResult {
  const stations: StationResult[] = analysis.all.map((station) => {
    const reached = analysis.reached.some((s) => s.id === station.id);
    return {
      id: station.id,
      name: station.name,
      travelMm: tenthsMmToMmString(station.travelTenthsMm),
      gapMm: reached ? tenthsMmToMmString(station.gapTenthsMm) : null,
      passes: reached && station.gapTenthsMm >= MIN_CLEARANCE_TENTHS_MM,
    };
  });
  return {
    railMm: tenthsMmToMmString(analysis.railTenthsMm),
    stopTravelMm: tenthsMmToMmString(analysis.stopTravelTenthsMm),
    foulingFeature: analysis.contactAt ? analysis.contactAt.name : null,
    stations,
  };
}

/** An exact rational share, kept unevaluated so comparisons stay integral. */
interface Share {
  num: bigint;
  den: bigint;
}

function frontShare(
  parts: readonly { massTenthsKg: number; xTenthsMm: number }[],
  wheelbaseTenthsMm: number,
): Share {
  let moment = 0n;
  let mass = 0n;
  for (const part of parts) {
    moment += BigInt(part.massTenthsKg) * BigInt(part.xTenthsMm);
    mass += BigInt(part.massTenthsKg);
  }
  return { num: moment, den: mass * BigInt(wheelbaseTenthsMm) };
}

/** A share as tenths of a percentage point, rounded half up for display. */
function shareToTenthsPct(share: Share): number {
  const num = share.num * 1000n;
  const q = num / share.den;
  const rem = num - q * share.den;
  return Number(rem * 2n >= share.den ? q + 1n : q);
}

interface AxleAnalysis {
  result: AxleResult;
  passes: boolean;
  shiftTenthsPct: number;
}

/**
 * Front share = Σ(mass × x) ÷ (Σmass × wheelbase), with x from the rear axle.
 * The shift is the absolute difference of the two exact fractions, compared
 * exactly against the limit. Display values round half up to one decimal.
 */
function analyseAxle(donor: ResolvedDonor, packId: string, hubId: string): AxleAnalysis {
  const donorRow = donorByModel(donor.model);
  const pack = packById(packId);
  const hub = hubById(hubId);
  if (!donorRow || !pack || !hub) throw new Error('axle analysis needs a known donor, pack and hub');

  const donorShare = frontShare(
    [donorRow.chassis, donorRow.engineExhaust, donorRow.fuelTank],
    donorRow.wheelbaseTenthsMm,
  );
  const builtShare = frontShare(
    [
      donorRow.chassis,
      { massTenthsKg: pack.massTenthsKg, xTenthsMm: donorRow.bayXTenthsMm },
      { massTenthsKg: hub.massTenthsKg, xTenthsMm: 0 },
      { massTenthsKg: CONTROLLER.massTenthsKg, xTenthsMm: CONTROLLER.xTenthsMm },
    ],
    donorRow.wheelbaseTenthsMm,
  );

  const crossDiff = builtShare.num * donorShare.den - donorShare.num * builtShare.den;
  const absDiff = crossDiff < 0n ? -crossDiff : crossDiff;
  const product = builtShare.den * donorShare.den;
  // shift ≤ limit ⟺ |ad − cb| × 1000 ≤ limitTenthsPct × b × d
  const passes = absDiff * 1000n <= BigInt(AXLE_SHIFT_LIMIT_TENTHS_PCT) * product;
  const shiftTenthsPct = shareToTenthsPct({ num: absDiff, den: product });

  return {
    passes,
    shiftTenthsPct,
    result: {
      donorFrontPct: tenthsPctToString(shareToTenthsPct(donorShare)),
      builtFrontPct: tenthsPctToString(shareToTenthsPct(builtShare)),
      shiftPct: tenthsPctToString(shiftTenthsPct),
      passes,
    },
  };
}

/** Built mass is the sum of the built parts: chassis, pack, hub and controller. */
export function builtMassTenthsKg(model: string, packId: string, hubId: string): number {
  const donorRow = donorByModel(model);
  const pack = packById(packId);
  const hub = hubById(hubId);
  if (!donorRow || !pack || !hub) throw new Error('built mass needs a known donor, pack and hub');
  return donorRow.chassis.massTenthsKg + pack.massTenthsKg + hub.massTenthsKg + CONTROLLER.massTenthsKg;
}

/** Range in km is the pack's watt-hours divided by consumption, rounded down. */
export function rangeKm(packId: string, roadClass: RoadClass): number {
  const pack = packById(packId);
  if (!pack) throw new Error(`unknown pack ${packId}`);
  return Math.floor(pack.wattHours / CONSUMPTION_WH_PER_KM[roadClass]);
}

/** The pack rail length is the travel of the revision's last station. */
export function packRailTenthsMm(donor: ResolvedDonor): number {
  const stations = frameRevision(donor.model, donor.revision)?.stations ?? [];
  return stations[stations.length - 1]?.travelTenthsMm ?? 0;
}

export const HUB_RAIL_TENTHS_MM =
  HUB_STATION_TRAVELS[HUB_STATION_TRAVELS.length - 1]?.travelTenthsMm ?? 0;

export interface FitInput {
  donor: ResolvedDonor;
  packId: string;
  hubId: string;
  roadClass: RoadClass;
  units: Units;
}

function buildLimits(
  donor: ResolvedDonor,
  packId: string,
  hubId: string,
  roadClass: RoadClass,
  axle: AxleAnalysis,
  units: Units,
): LimitResult[] {
  const donorRow = donorByModel(donor.model);
  const pack = packById(packId);
  const hub = hubById(hubId);
  if (!donorRow || !pack || !hub) throw new Error('limits need a known donor, pack and hub');

  const classLimit = CLASS_POWER_LIMIT_TENTHS_KW[roadClass];
  const className = ROAD_CLASS_NAMES[donor.country][roadClass];
  const builtMass = builtMassTenthsKg(donor.model, packId, hubId);

  const classPowerPasses = hub.powerTenthsKw <= classLimit;
  const donorPowerPasses = hub.powerTenthsKw * 100 <= donorRow.powerTenthsKw * DONOR_POWER_LIMIT_PCT;
  const massPasses = builtMass <= donor.registeredMassTenthsKg;
  const growth = pack.growth;

  return [
    {
      rule: 'axle_split',
      passes: axle.passes,
      sentence: axle.passes
        ? null
        : `Axle split moves ${tenthsPctToString(axle.shiftTenthsPct)} points; the limit is ${tenthsPctToString(AXLE_SHIFT_LIMIT_TENTHS_PCT)}.`,
    },
    {
      rule: 'road_class_power',
      passes: classPowerPasses,
      sentence: classPowerPasses
        ? null
        : `Hub power ${tenthsKwToString(hub.powerTenthsKw)} kW is over the ${className} limit of ${tenthsKwToString(classLimit)} kW.`,
    },
    {
      rule: 'donor_power',
      passes: donorPowerPasses,
      sentence: donorPowerPasses
        ? null
        : `Hub power ${tenthsKwToString(hub.powerTenthsKw)} kW is over ${DONOR_POWER_LIMIT_PCT} percent of the donor's ${tenthsKwToString(donorRow.powerTenthsKw)} kW.`,
    },
    {
      rule: 'registered_mass',
      passes: massPasses,
      sentence: massPasses
        ? null
        : `Built mass ${formatMass(builtMass, units)} is over the registered ${formatMass(donor.registeredMassTenthsKg, units)}.`,
    },
    {
      rule: 'overall_dimensions',
      passes: growth === null,
      sentence:
        growth === null
          ? null
          : `The kit grows the overall ${growth.dimension} by ${formatLength(growth.tenthsMm, units)}.`,
    },
  ];
}

/**
 * Decide the verdict across both rails and every limit.
 *
 * Verdict order is `fouls`, then `too_tight`, then `outside_limits`, then
 * `fits`. The sentence names the first failing item, pack rail before hub
 * rail and stations in order, with limits in the order of the rule list.
 */
export function checkFit(input: FitInput): FitResult {
  const { donor, packId, hubId, roadClass, units } = input;

  const packRail = analyseRail(packStationGaps(donor, packId), packRailTenthsMm(donor));
  const hubRail = analyseRail(hubStationGaps(donor, hubId), HUB_RAIL_TENTHS_MM);
  const axle = analyseAxle(donor, packId, hubId);
  const limits = buildLimits(donor, packId, hubId, roadClass, axle, units);

  const { verdict, word, sentence } = decide(packRail, hubRail, limits, units);

  return {
    verdict,
    word,
    sentence: donor.confirmed ? sentence : `${sentence} Donor unconfirmed.`,
    confirmed: donor.confirmed,
    revision: donor.revision,
    rails: { pack: railResult(packRail), hub: railResult(hubRail) },
    axle: axle.result,
    builtMassKg: tenthsToOneDecimalString(builtMassTenthsKg(donor.model, packId, hubId)),
    rangeKm: rangeKm(packId, roadClass),
    limits,
  };
}

function decide(
  packRail: RailAnalysis,
  hubRail: RailAnalysis,
  limits: readonly LimitResult[],
  units: Units,
): { verdict: Verdict; word: string; sentence: string } {
  for (const [analysis, partName] of [
    [packRail, PACK_PART_NAME],
    [hubRail, HUB_PART_NAME],
  ] as const) {
    if (analysis.contactAt) {
      return {
        verdict: 'fouls',
        word: 'Fouls',
        sentence: `Fouls. ${partName} stops at ${formatLength(analysis.stopTravelTenthsMm, units)} on ${analysis.contactAt.name}.`,
      };
    }
  }

  for (const analysis of [packRail, hubRail]) {
    for (const station of analysis.reached) {
      if (station.gapTenthsMm < MIN_CLEARANCE_TENTHS_MM) {
        return {
          verdict: 'too_tight',
          word: 'Too tight',
          sentence: `Too tight. Gap ${formatLength(station.gapTenthsMm, units)} at ${station.name}; the minimum is ${formatLength(MIN_CLEARANCE_TENTHS_MM, units)}.`,
        };
      }
    }
  }

  const broken = limits.find((limit) => !limit.passes);
  if (broken?.sentence) {
    return { verdict: 'outside_limits', word: 'Outside limits', sentence: `Outside limits. ${broken.sentence}` };
  }

  const smallest = smallestGap(packRail, hubRail);
  return {
    verdict: 'fits',
    word: 'Fits',
    sentence: `Fits. Smallest gap ${formatLength(smallest.gapTenthsMm, units)} at ${smallest.name}.`,
  };
}

/** The smallest gap across both rails, with the pack rail winning ties. */
function smallestGap(packRail: RailAnalysis, hubRail: RailAnalysis): StationGap {
  let best: StationGap | null = null;
  for (const analysis of [packRail, hubRail]) {
    for (const station of analysis.reached) {
      if (best === null || station.gapTenthsMm < best.gapTenthsMm) best = station;
    }
  }
  if (!best) throw new Error('a rail must have at least one station');
  return best;
}
