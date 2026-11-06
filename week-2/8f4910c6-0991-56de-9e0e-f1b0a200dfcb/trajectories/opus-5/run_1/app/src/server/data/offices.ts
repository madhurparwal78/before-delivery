import { query } from '../db.js';
import type { OfficeId, OfficeRecord } from '../../shared/types.js';
import type { OfficeInfo } from '../domain/offices.js';

type OfficeRow = { id: OfficeId; city: string; time_zone: string };
type ClosureRow = { office_id: OfficeId; closure_date: string };

export async function loadOffices(): Promise<Map<OfficeId, OfficeInfo>> {
  const offices = await query<OfficeRow>('SELECT * FROM offices ORDER BY id');
  const closures = await query<ClosureRow>('SELECT * FROM office_closures ORDER BY closure_date');
  const map = new Map<OfficeId, OfficeInfo>();
  for (const office of offices) {
    map.set(office.id, {
      id: office.id,
      city: office.city,
      timeZone: office.time_zone,
      closures: new Set(closures.filter((row) => row.office_id === office.id).map((row) => row.closure_date)),
    });
  }
  return map;
}

export async function loadOffice(id: OfficeId): Promise<OfficeInfo> {
  const offices = await loadOffices();
  const office = offices.get(id);
  if (!office) throw new Error(`unknown office ${id}`);
  return office;
}

export function officeView(office: OfficeInfo): OfficeRecord {
  return {
    id: office.id,
    city: office.city,
    timeZone: office.timeZone,
    closures: [...office.closures].sort(),
  };
}
