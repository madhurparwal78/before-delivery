/**
 * Resolving a donor, from the registry or from hand entry.
 *
 * A plate donor reads the registry fresh on every call and is `confirmed`.
 * A hand-entered donor is never confirmed, so a quote made from it can never
 * take a deposit.
 */

import {
  ROAD_CLASS_NAMES,
  donorByModel,
  revisionFor,
} from '../../shared/seed.js';
import type {
  DonorInput,
  ManualDonorInput,
  PlateColour,
  RegCountry,
  ResolvedDonor,
  RoadClass,
} from '../../shared/types.js';
import { canonicalPlate, invalidPlateMessage, isRegCountry } from '../domain/plates.js';
import { lookupPlate, type RegistryRecord } from '../providers/registry.js';
import { ApiError, ValidationError } from '../http/errors.js';

export const NOT_CATALOGUED_MESSAGE = 'That model is not in our catalogue yet.';
const REG_COUNTRY_MESSAGE = 'Enter NL, BE or DE.';

function isPlateDonor(donor: DonorInput): donor is { plate: string; country: RegCountry } {
  return 'plate' in donor;
}

function fromRecord(record: RegistryRecord): ResolvedDonor {
  const catalogued = donorByModel(record.model);
  if (!catalogued) throw new ValidationError({ plate: NOT_CATALOGUED_MESSAGE });
  return {
    plate: record.plate,
    country: record.country,
    model: record.model,
    modelName: catalogued.name,
    firstAdmissionYear: record.firstAdmissionYear,
    roadClass: record.roadClass,
    className: ROAD_CLASS_NAMES[record.country][record.roadClass],
    plateColour: record.plateColour,
    registeredMassTenthsKg: record.registeredMassTenthsKg,
    revision: revisionFor(record.model, record.firstAdmissionYear),
    confirmed: true,
  };
}

/** Registered mass takes a decimal point and at most one decimal. */
function massTenths(value: number | string): number | null {
  const text = typeof value === 'number' ? String(value) : value.trim();
  if (!/^\d{1,4}(\.\d)?$/.test(text)) return null;
  const tenths = Math.round(Number(text) * 10);
  return tenths > 0 ? tenths : null;
}

function resolveManual(manual: ManualDonorInput): ResolvedDonor {
  const errors: Record<string, string> = {};

  if (!isRegCountry(manual.country)) errors.country = REG_COUNTRY_MESSAGE;

  const catalogued = typeof manual.model === 'string' ? donorByModel(manual.model) : undefined;
  if (!catalogued) errors.model = NOT_CATALOGUED_MESSAGE;

  const year = Number(manual.firstAdmissionYear);
  if (!Number.isInteger(year) || year < 1900 || year > 2100) {
    errors.year = 'Enter a four-digit year.';
  }

  const roadClass = Number(manual.roadClass);
  if (roadClass !== 25 && roadClass !== 45) errors.regClass = 'Enter 25 or 45.';

  const colours: PlateColour[] = ['blue', 'yellow', 'white'];
  if (!colours.includes(manual.plateColour)) errors.colour = 'Enter blue, yellow or white.';

  const tenths = massTenths(manual.registeredMassKg);
  if (tenths === null) errors.mass = 'Enter a mass like 86.0.';

  if (Object.keys(errors).length > 0) throw new ValidationError(errors);
  if (!catalogued || tenths === null) throw new ValidationError({ model: NOT_CATALOGUED_MESSAGE });

  const country = manual.country;
  return {
    plate: null,
    country,
    model: catalogued.model,
    modelName: catalogued.name,
    firstAdmissionYear: year,
    roadClass: roadClass as RoadClass,
    className: ROAD_CLASS_NAMES[country][roadClass as RoadClass],
    plateColour: manual.plateColour,
    registeredMassTenthsKg: tenths,
    revision: revisionFor(catalogued.model, year),
    confirmed: false,
  };
}

/**
 * Resolve a donor. A plate is normalised first, and an invalid one makes no
 * registry request.
 */
export async function resolveDonor(donor: DonorInput): Promise<ResolvedDonor> {
  if (!donor || typeof donor !== 'object') throw new ValidationError({ donor: 'Required.' });

  if (isPlateDonor(donor)) {
    if (!isRegCountry(donor.country)) throw new ValidationError({ country: REG_COUNTRY_MESSAGE });
    if (typeof donor.plate !== 'string') throw new ValidationError({ plate: invalidPlateMessage(donor.country) });

    const plate = canonicalPlate(donor.plate, donor.country);
    if (!plate) throw new ValidationError({ plate: invalidPlateMessage(donor.country) });

    const answer = await lookupPlate(plate, donor.country);
    if (answer.outcome === 'unreachable') throw new ApiError(503, 'registry_unreachable');
    if (answer.outcome === 'not_found') throw new ApiError(404, 'plate_not_found');
    return fromRecord(answer.record);
  }

  if ('manual' in donor && donor.manual && typeof donor.manual === 'object') {
    return resolveManual(donor.manual);
  }

  throw new ValidationError({ donor: 'Required.' });
}

/** Whether a fresh read still matches the stored donor. */
export function donorMatches(stored: ResolvedDonor, fresh: ResolvedDonor): boolean {
  return (
    stored.model === fresh.model &&
    stored.firstAdmissionYear === fresh.firstAdmissionYear &&
    stored.roadClass === fresh.roadClass &&
    stored.plateColour === fresh.plateColour &&
    stored.registeredMassTenthsKg === fresh.registeredMassTenthsKg
  );
}

export { isPlateDonor };
