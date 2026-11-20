export const CITIES = [
  'Kestrevel',
  'Vardholm',
  'Brisanne',
  'Oakhythe',
  'Tollemarch',
  'Saint Ivrel',
  'Corrandy',
  'Hesketh Mere',
] as const;

export type City = (typeof CITIES)[number];

const TABLE: ReadonlyArray<readonly [City, City, number]> = [
  ['Kestrevel', 'Brisanne', 67],
  ['Kestrevel', 'Oakhythe', 126],
  ['Kestrevel', 'Tollemarch', 213],
  ['Kestrevel', 'Vardholm', 70],
  ['Kestrevel', 'Saint Ivrel', 136],
  ['Kestrevel', 'Corrandy', 230],
  ['Kestrevel', 'Hesketh Mere', 77],
  ['Brisanne', 'Oakhythe', 59],
  ['Brisanne', 'Tollemarch', 146],
  ['Brisanne', 'Vardholm', 88],
  ['Brisanne', 'Saint Ivrel', 95],
  ['Brisanne', 'Corrandy', 173],
  ['Brisanne', 'Hesketh Mere', 99],
  ['Oakhythe', 'Tollemarch', 87],
  ['Oakhythe', 'Vardholm', 131],
  ['Oakhythe', 'Saint Ivrel', 84],
  ['Oakhythe', 'Corrandy', 127],
  ['Oakhythe', 'Hesketh Mere', 146],
  ['Tollemarch', 'Vardholm', 211],
  ['Tollemarch', 'Saint Ivrel', 134],
  ['Tollemarch', 'Corrandy', 99],
  ['Tollemarch', 'Hesketh Mere', 224],
  ['Vardholm', 'Saint Ivrel', 95],
  ['Vardholm', 'Corrandy', 196],
  ['Vardholm', 'Hesketh Mere', 146],
  ['Saint Ivrel', 'Corrandy', 101],
  ['Saint Ivrel', 'Hesketh Mere', 191],
  ['Corrandy', 'Hesketh Mere', 270],
];

const distances = new Map<string, number>();
for (const [from, to, km] of TABLE) {
  distances.set(`${from}|${to}`, km);
  distances.set(`${to}|${from}`, km);
}

export function isCity(value: unknown): value is City {
  return typeof value === 'string' && (CITIES as readonly string[]).includes(value);
}

export function legKm(from: City, to: City): number {
  const km = distances.get(`${from}|${to}`);
  if (km === undefined) throw new Error(`No distance between ${from} and ${to}`);
  return km;
}

export function distanceList(): Array<{ from: City; to: City; km: number }> {
  return TABLE.map(([from, to, km]) => ({ from, to, km }));
}
