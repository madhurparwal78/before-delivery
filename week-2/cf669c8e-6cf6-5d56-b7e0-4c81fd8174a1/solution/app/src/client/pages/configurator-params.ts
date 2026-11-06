import { oneOf } from '../../shared/choice.js';
import {
  DELIVERY_COUNTRIES, FULFILMENTS, PLATE_COLOURS, REG_COUNTRIES, UNIT_SYSTEMS,
  type Config, type Country, type DonorInput, type Fulfilment, type ManualFrame, type RegCountry, type RoadClass, type Units,
} from '../../shared/types.js';

export interface Params {
  plate: string;
  regCountry: RegCountry;
  manual: ManualFrame | null;
  pack: string;
  hub: string;
  roadClass: RoadClass | null;
  units: Units;
  fulfilment: Fulfilment;
  country: Country;
}

export function parseParams(search: URLSearchParams): Params {
  const regCountry = oneOf(search.get('regCountry'), REG_COUNTRIES) ?? 'NL';
  const roadClass = search.get('class');
  const manual: ManualFrame | null = search.get('manual') === '1'
    ? {
      model: search.get('model') ?? 'K50', country: regCountry, firstAdmissionYear: Number(search.get('year') ?? ''),
      roadClass: search.get('regClass') === '45' ? 45 : 25, plateColour: oneOf(search.get('colour'), PLATE_COLOURS) ?? 'blue',
      registeredMassKg: Number(search.get('mass') ?? ''),
    }
    : null;
  return {
    plate: search.get('plate') ?? '', regCountry, manual,
    pack: search.get('pack') ?? 'P-1500', hub: search.get('hub') ?? 'H-1000',
    roadClass: roadClass === '25' ? 25 : roadClass === '45' ? 45 : null,
    units: oneOf(search.get('units'), UNIT_SYSTEMS) ?? 'metric',
    fulfilment: oneOf(search.get('fulfilment'), FULFILMENTS) ?? 'posted',
    country: oneOf(search.get('country'), DELIVERY_COUNTRIES) ?? 'NL',
  };
}

export function toSearch(p: Params, roadClass: RoadClass): string {
  const out = new URLSearchParams();
  if (p.manual) {
    out.set('manual', '1');
    out.set('model', p.manual.model);
    out.set('regCountry', p.regCountry);
    out.set('year', String(p.manual.firstAdmissionYear));
    out.set('regClass', String(p.manual.roadClass));
    out.set('colour', p.manual.plateColour);
    out.set('mass', Number.isInteger(p.manual.registeredMassKg) ? p.manual.registeredMassKg.toFixed(1) : String(p.manual.registeredMassKg));
  } else if (p.plate) {
    out.set('plate', p.plate);
    out.set('regCountry', p.regCountry);
  }
  out.set('pack', p.pack);
  out.set('hub', p.hub);
  out.set('class', String(roadClass));
  out.set('units', p.units);
  out.set('fulfilment', p.fulfilment);
  out.set('country', p.country);
  return `/configure?${out.toString()}`;
}

export function donorInput(p: Params, plateCanonical: string | null): DonorInput | null {
  if (p.manual) return { manual: p.manual };
  return plateCanonical ? { plate: plateCanonical, country: p.regCountry } : null;
}

export function configOf(donor: DonorInput, p: Params, roadClass: RoadClass): Config {
  return { donor, packId: p.pack, hubId: p.hub, roadClass, fulfilment: p.fulfilment, country: p.country, units: p.units };
}
