export type Area = { name: string; lat: number; lon: number };

/** The seeded areas offered by Your area, in the order of the Areas table. */
export const AREAS: readonly Area[] = [
  { name: 'Lisboa', lat: 38.7223, lon: -9.1393 },
  { name: 'Porto', lat: 41.1579, lon: -8.6291 },
  { name: 'Faro', lat: 37.0194, lon: -7.9304 },
  { name: 'Coimbra', lat: 40.2033, lon: -8.4103 },
  { name: 'Braga', lat: 41.5454, lon: -8.4265 },
  { name: 'Ponta Delgada', lat: 37.7412, lon: -25.6756 },
  { name: 'Angra do Heroísmo', lat: 38.655, lon: -27.221 },
];

export function areaAt(point: { lat: number; lon: number } | null): Area | null {
  if (!point) return null;
  return (
    AREAS.find(
      (area) => Math.abs(area.lat - point.lat) < 1e-6 && Math.abs(area.lon - point.lon) < 1e-6,
    ) ?? null
  );
}
