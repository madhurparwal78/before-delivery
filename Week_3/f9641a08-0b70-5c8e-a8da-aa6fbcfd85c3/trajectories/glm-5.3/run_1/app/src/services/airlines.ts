export type Airline = { code: string; name: string; height_cm: number; width_cm: number; depth_cm: number; weight_kg: number };

/** Invented cabin frames, wheels and handles included. */
export const AIRLINES: Airline[] = [
  { code: 'skyline-indus', name: 'Skyline Indus', height_cm: 55, width_cm: 40, depth_cm: 20, weight_kg: 7 },
  { code: 'monsoon-air', name: 'Monsoon Air', height_cm: 56, width_cm: 36, depth_cm: 23, weight_kg: 8 },
  { code: 'coastal-hop', name: 'Coastal Hop', height_cm: 52, width_cm: 40, depth_cm: 22, weight_kg: 7 },
  { code: 'northwind', name: 'Northwind Regional', height_cm: 40, width_cm: 30, depth_cm: 20, weight_kg: 5 },
];

export function airlineByCode(code: string): Airline | undefined {
  return AIRLINES.find((a) => a.code === code);
}

export function airlineCodes(): Airline[] {
  return AIRLINES;
}
