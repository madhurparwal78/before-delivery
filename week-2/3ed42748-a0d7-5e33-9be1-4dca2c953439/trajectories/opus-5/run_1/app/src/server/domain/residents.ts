import { query } from '../db/pool.js';

export interface Resident {
  resident_id: string;
  name: string;
  home: string;
  door: { lat: number; lon: number };
}

let cached: Resident[] | null = null;

export async function residents(): Promise<Resident[]> {
  if (!cached) {
    const rows = await query<{
      resident_id: string;
      name: string;
      home: string;
      door_lat: number;
      door_lon: number;
    }>('select resident_id, name, home, door_lat, door_lon from residents order by ordinal');
    cached = rows.map((row) => ({
      resident_id: row.resident_id,
      name: row.name,
      home: row.home,
      door: { lat: row.door_lat, lon: row.door_lon },
    }));
  }
  return cached;
}

export async function resident(residentId: string): Promise<Resident> {
  const found = (await residents()).find((candidate) => candidate.resident_id === residentId);
  if (!found) throw new Error(`Unknown resident ${residentId}`);
  return found;
}

export async function residentIds(): Promise<Set<string>> {
  return new Set((await residents()).map((candidate) => candidate.resident_id));
}
