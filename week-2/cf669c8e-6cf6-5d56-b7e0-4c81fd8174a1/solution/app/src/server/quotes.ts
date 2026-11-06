/** Turning a request's configuration into a donor frame, a fit result and a priced quote. */
import { oneOf } from '../shared/choice.js';
import {
  DELIVERY_COUNTRIES, FULFILMENTS, PLATE_COLOURS, REG_COUNTRIES, ROAD_CLASSES, UNIT_SYSTEMS,
  type Config, type Country, type DonorInput, type Fulfilment, type PlateRecord, type Quote, type RegCountry, type RoadClass, type Units,
} from '../shared/types.js';
import { ROAD_CLASS_NAMES, donorOf, hubOf, packOf, parseTenths, tenthsText, type Hub, type Pack } from './catalogue.js';
import { amsterdamToday } from './clock.js';
import { fail, invalid, isRecord } from './errors.js';
import { fitResult, revisionOf, type Frame } from './fit.js';
import { inspectionFee, kitLines, quoteOf, type LineSpec } from './pricing.js';
import { RegistryUnreachable, canonicalPlate, plateExample, readPlate, registryUnreachable, type RegistryRecord } from './registry.js';

const NOTICE_INSURANCE = 'Insurance: the scooter is uninsured on public roads once the work has begun, until it passes inspection.';
const NOTICE_MOVE = [
  'Plate: a new plate is needed for the new class.',
  'Helmet: a helmet is required in the 45 km/h class.',
  'Licence: check the licence your class requires before riding.',
];
const NOT_CATALOGUED = 'That model is not in our catalogue yet.';

export function noticesFor(classMove: boolean): string[] {
  return classMove ? [NOTICE_INSURANCE, ...NOTICE_MOVE] : [NOTICE_INSURANCE];
}

export async function lookupFrame(plateInput: string, country: unknown): Promise<{ record: RegistryRecord; frame: Frame }> {
  if (country !== 'NL' && country !== 'BE' && country !== 'DE') throw invalid({ country: 'Enter NL, BE or DE.' });
  const plate = canonicalPlate(plateInput, country);
  if (!plate) throw invalid({ plate: `Enter a plate like ${plateExample(country)}.` });
  let record: RegistryRecord | null;
  try {
    record = await readPlate(plate, country);
  } catch (error) {
    if (error instanceof RegistryUnreachable) throw registryUnreachable();
    throw error;
  }
  if (!record) throw fail(404, 'plate_not_found');
  const model = donorOf(record.model);
  if (!model) throw invalid({ plate: NOT_CATALOGUED });
  return { record, frame: frameOfRecord(record, model) };
}

function frameOfRecord(record: RegistryRecord, model: NonNullable<ReturnType<typeof donorOf>>): Frame {
  return {
    plate: record.plate, regCountry: record.country, model, firstAdmissionYear: record.firstAdmissionYear, roadClass: record.roadClass,
    plateColour: record.plateColour, registeredMassT: record.registeredMassT, confirmed: true,
  };
}

export function plateRecordBody(record: RegistryRecord, frame: Frame): PlateRecord {
  return {
    plate: record.plate, country: record.country, model: record.model, modelName: frame.model.name,
    firstAdmissionYear: record.firstAdmissionYear, roadClass: record.roadClass, className: ROAD_CLASS_NAMES[record.country][record.roadClass],
    plateColour: record.plateColour, registeredMassKg: tenthsText(record.registeredMassT), revision: revisionOf(frame.model, record.firstAdmissionYear),
    confirmed: true,
  };
}

function manualFrame(raw: Record<string, unknown>): { frame: Frame } | { errors: Record<string, string> } {
  const model = typeof raw['model'] === 'string' ? donorOf(raw['model']) : undefined;
  const country = oneOf(raw['country'], REG_COUNTRIES);
  const year = raw['firstAdmissionYear'];
  const firstAdmissionYear = typeof year === 'number' && Number.isInteger(year) && year >= 1950 && year <= 2100 ? year : null;
  const roadClass = oneOf(raw['roadClass'], ROAD_CLASSES);
  const plateColour = oneOf(raw['plateColour'], PLATE_COLOURS);
  const mass = parseTenths(raw['registeredMassKg']);
  if (model && country && firstAdmissionYear !== null && roadClass && plateColour && mass !== null && mass > 0) {
    return { frame: { plate: null, regCountry: country, model, firstAdmissionYear, roadClass, plateColour, registeredMassT: mass, confirmed: false } };
  }
  const errors: Record<string, string> = {};
  if (!model) errors['model'] = 'Choose a listed model.';
  if (!country) errors['country'] = 'Enter NL, BE or DE.';
  if (firstAdmissionYear === null) errors['firstAdmissionYear'] = 'Enter a four-digit year.';
  if (!roadClass) errors['roadClass'] = 'Choose 25 or 45.';
  if (!plateColour) errors['plateColour'] = 'Choose blue, yellow or white.';
  if (mass === null || mass <= 0) errors['registeredMassKg'] = 'Enter a mass like 86.0.';
  return { errors };
}

interface Resolved {
  frame: Frame;
  pack: Pack;
  hub: Hub;
  target: RoadClass;
  fulfilment: Fulfilment;
  country: Country;
  units: Units;
  donor: DonorInput;
}

function isDonorInput(value: unknown): value is DonorInput {
  return isRecord(value) && (isRecord(value['manual']) || typeof value['plate'] === 'string');
}

/** Everything static is validated first (422); the registry is read only then (503); the class check needs its answer. */
export async function resolveConfig(input: unknown): Promise<Resolved> {
  if (!isRecord(input)) throw invalid({ config: 'Required.' });
  const errors: Record<string, string> = {};
  const donor = isDonorInput(input['donor']) ? input['donor'] : null;
  if (!donor) errors['donor'] = 'Choose a donor.';
  const pack = typeof input['packId'] === 'string' ? packOf(input['packId']) : undefined;
  if (!pack) errors['packId'] = 'Choose a listed pack.';
  const hub = typeof input['hubId'] === 'string' ? hubOf(input['hubId']) : undefined;
  if (!hub) errors['hubId'] = 'Choose a listed hub.';
  const target = oneOf(input['roadClass'], ROAD_CLASSES);
  if (!target) errors['roadClass'] = 'Choose 25 or 45.';
  const fulfilment = oneOf(input['fulfilment'] ?? 'posted', FULFILMENTS);
  if (!fulfilment) errors['fulfilment'] = 'Choose posted or workshop.';
  const country = oneOf(input['country'] ?? 'NL', DELIVERY_COUNTRIES);
  const units = oneOf(input['units'] ?? 'metric', UNIT_SYSTEMS);
  if (!units) errors['units'] = 'Choose metric or imperial.';
  let frame: Frame | null = null;
  if (donor && 'manual' in donor) {
    const built = manualFrame({ ...donor.manual });
    if ('errors' in built) Object.assign(errors, built.errors);
    else frame = built.frame;
  }
  if (!country) errors['country'] = 'Enter NL, BE, DE or LU.';
  if (donor && 'plate' in donor) {
    const registration = oneOf(donor.country, REG_COUNTRIES);
    if (!registration) errors['country'] = 'Enter NL, BE or DE.';
    else if (!canonicalPlate(donor.plate, registration)) errors['plate'] = `Enter a plate like ${plateExample(registration)}.`;
  }
  if (Object.keys(errors).length || !donor || !pack || !hub || !target || !fulfilment || !country || !units) throw invalid(errors);
  if ('plate' in donor) frame = (await lookupFrame(donor.plate, donor.country)).frame;
  if (!frame) throw invalid({ donor: 'Choose a donor.' });
  if (frame.roadClass > target) throw invalid({ roadClass: 'A kit cannot move a scooter down a road class.' });
  return { frame, pack, hub, target, fulfilment, country, units, donor };
}

export function isClassMove(frame: Frame, target: RoadClass): boolean {
  return frame.roadClass < target;
}

/** The lines of a kit order: the inspection fee line exists only on a class move and is priced by the Amsterdam date. */
export function orderSpecs(pack: Pack, hub: Hub, fulfilment: Fulfilment, country: Country, registration: RegCountry, classMove: boolean, today: string): LineSpec[] {
  const fee = classMove ? { code: `INSPECT-${registration}`, grossCents: inspectionFee(registration, today) } : null;
  return kitLines(pack, hub, fulfilment, country, fee);
}

export function specsOf(resolved: Resolved, today: string): LineSpec[] {
  return orderSpecs(resolved.pack, resolved.hub, resolved.fulfilment, resolved.country, resolved.frame.regCountry, isClassMove(resolved.frame, resolved.target), today);
}

export function quoteOfResolved(resolved: Resolved): Quote {
  const today = amsterdamToday();
  return quoteOf(
    specsOf(resolved, today), today, noticesFor(isClassMove(resolved.frame, resolved.target)),
    fitResult(resolved.frame, resolved.pack, resolved.hub, resolved.target, resolved.units),
  );
}

export function configOf(resolved: Resolved): Config {
  return {
    donor: resolved.frame.plate ? { plate: resolved.frame.plate, country: resolved.frame.regCountry } : resolved.donor, packId: resolved.pack.id, hubId: resolved.hub.id, roadClass: resolved.target,
    fulfilment: resolved.fulfilment, country: resolved.country, units: resolved.units,
  };
}
