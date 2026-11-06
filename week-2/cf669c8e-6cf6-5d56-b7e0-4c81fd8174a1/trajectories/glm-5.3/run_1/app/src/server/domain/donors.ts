import { DONORS } from './seed.js';
import { canonicalPlate, plateExample } from './plates.js';
import type { FitDonor } from './fit.js';
import { Registry, RegistryError } from '../services/registry.js';

// Donor parsing: plate donors read the registry fresh; hand entries are always
// marked unconfirmed.

export class DonorError extends Error {
  constructor(public status: number, public code: string | null, public field: string | null, message: string | null) {
    super(message ?? code ?? 'donor_error');
  }
}

export interface ParsedDonor {
  donor: FitDonor;
  manual: boolean;
  plate: string | null;
  country: string;
}

export async function parseDonorBody(donor: Record<string, unknown>, registry: Registry): Promise<ParsedDonor> {
  if (donor['manual'] !== undefined) {
    const m = donor['manual'] as Record<string, unknown>;
    const model = String(m['model'] ?? '');
    const country = String(m['country'] ?? '');
    const year = Number(m['firstAdmissionYear'] ?? 0);
    const roadClass = Number(m['roadClass'] ?? 0);
    const plateColour = String(m['plateColour'] ?? '');
    const massKg = Number(m['registeredMassKg'] ?? NaN);
    const errors: Record<string, string> = {};
    if (!DONORS.some((d) => d.id === model)) errors['model'] = 'Pick a model.';
    if (!['NL', 'BE', 'DE'].includes(country)) errors['country'] = 'Enter NL, BE or DE.';
    if (!Number.isInteger(year) || year < 1900 || year > 2100) errors['firstAdmissionYear'] = 'Enter the first-admission year.';
    if (roadClass !== 25 && roadClass !== 45) errors['roadClass'] = 'Pick the registered road class.';
    if (!['blue', 'yellow', 'white'].includes(plateColour)) errors['plateColour'] = 'Pick the plate colour.';
    if (!Number.isFinite(massKg) || massKg <= 0 || (massKg * 10) % 1 !== 0) errors['registeredMassKg'] = 'Enter the registered mass in kg.';
    if (Object.keys(errors).length > 0) throw new DonorError(422, null, null, JSON.stringify(errors));
    return {
      donor: {
        model, country, firstAdmissionYear: year, roadClass: roadClass as 25 | 45,
        plateColour, registeredMassKg: Math.round(massKg * 10),
      },
      manual: true, plate: null, country,
    };
  }
  const plate = String(donor['plate'] ?? '');
  const country = String(donor['country'] ?? '');
  if (!['NL', 'BE', 'DE'].includes(country)) throw new DonorError(422, null, 'country', 'Enter NL, BE or DE.');
  const canonical = canonicalPlate(plate, country);
  if (!canonical) throw new DonorError(422, null, 'plate', `Enter a plate like ${plateExample(country)}.`);
  try {
    const rec = await registry.lookup(canonical, country);
    if (!DONORS.some((d) => d.id === rec.model)) throw new DonorError(422, null, 'plate', 'That model is not in our catalogue yet.');
    return {
      donor: {
        model: rec.model, country, firstAdmissionYear: rec.firstAdmissionYear,
        roadClass: rec.roadClass, plateColour: rec.plateColour,
        registeredMassKg: Math.round(rec.registeredMassKg * 10),
      },
      manual: false, plate: canonical, country,
    };
  } catch (e) {
    if (e instanceof DonorError) throw e;
    if (e instanceof RegistryError && e.kind === 'not_found') throw new DonorError(404, 'plate_not_found', null, null);
    throw new DonorError(503, 'registry_unreachable', null, null);
  }
}
