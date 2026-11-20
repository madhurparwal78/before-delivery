export const CITIES = [
  "Kestrevel",
  "Vardholm",
  "Brisanne",
  "Oakhythe",
  "Tollemarch",
  "Saint Ivrel",
  "Corrandy",
  "Hesketh Mere",
] as const;

export type City = (typeof CITIES)[number];

const TABLE: readonly (readonly [City, City, number])[] = [
  ["Kestrevel", "Brisanne", 67],
  ["Kestrevel", "Oakhythe", 126],
  ["Kestrevel", "Tollemarch", 213],
  ["Kestrevel", "Vardholm", 70],
  ["Kestrevel", "Saint Ivrel", 136],
  ["Kestrevel", "Corrandy", 230],
  ["Kestrevel", "Hesketh Mere", 77],
  ["Brisanne", "Oakhythe", 59],
  ["Brisanne", "Tollemarch", 146],
  ["Brisanne", "Vardholm", 88],
  ["Brisanne", "Saint Ivrel", 95],
  ["Brisanne", "Corrandy", 173],
  ["Brisanne", "Hesketh Mere", 99],
  ["Oakhythe", "Tollemarch", 87],
  ["Oakhythe", "Vardholm", 131],
  ["Oakhythe", "Saint Ivrel", 84],
  ["Oakhythe", "Corrandy", 127],
  ["Oakhythe", "Hesketh Mere", 146],
  ["Tollemarch", "Vardholm", 211],
  ["Tollemarch", "Saint Ivrel", 134],
  ["Tollemarch", "Corrandy", 99],
  ["Tollemarch", "Hesketh Mere", 224],
  ["Vardholm", "Saint Ivrel", 95],
  ["Vardholm", "Corrandy", 196],
  ["Vardholm", "Hesketh Mere", 146],
  ["Saint Ivrel", "Corrandy", 101],
  ["Saint Ivrel", "Hesketh Mere", 191],
  ["Corrandy", "Hesketh Mere", 270],
];

export const DISTANCES: readonly { from: City; to: City; km: number }[] = TABLE.map(([from, to, km]) => ({
  from,
  to,
  km,
}));

export function isCity(value: unknown): value is City {
  return typeof value === "string" && (CITIES as readonly string[]).includes(value);
}

export function legKm(a: City, b: City): number {
  const row = DISTANCES.find((d) => (d.from === a && d.to === b) || (d.from === b && d.to === a));
  if (!row) throw new Error(`no distance between ${a} and ${b}`);
  return row.km;
}
