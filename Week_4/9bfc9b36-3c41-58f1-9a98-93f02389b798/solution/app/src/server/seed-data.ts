/** The seed tables printed in the brief, as data. */
import type { DimensionKey, Role } from "../shared/types.js";

interface SeedAccount {
  id: string;
  num: number;
  name: string;
  email: string;
  role: Role;
  password: string;
}

export const ACCOUNTS: SeedAccount[] = [
  { id: "A-01", num: 1, name: "Morwenna Teague", email: "morwenna@tabling.example", role: "sailmaker", password: "Loft-Bench-2026!" },
  { id: "A-02", num: 2, name: "Jory Pascoe", email: "jory@tabling.example", role: "loft-hand", password: "Cutting-Floor-26!" },
  { id: "A-03", num: 3, name: "Kit Rowe", email: "kit@tabling.example", role: "loft-hand", password: "Cutting-Floor-26!" },
  { id: "A-04", num: 4, name: "Maren Holt", email: "maren@owners.example", role: "yacht-owner", password: "Tape-Measure-26!" },
  { id: "A-05", num: 5, name: "Tobias Wren", email: "tobias@owners.example", role: "yacht-owner", password: "Tape-Measure-26!" },
  { id: "A-06", num: 6, name: "Ines Calder", email: "ines@owners.example", role: "yacht-owner", password: "Tape-Measure-26!" },
  { id: "A-07", num: 7, name: "Rafe Okonkwo", email: "rafe@owners.example", role: "yacht-owner", password: "Tape-Measure-26!" },
  { id: "A-08", num: 8, name: "Saoirse Lindqvist", email: "saoirse@owners.example", role: "yacht-owner", password: "Tape-Measure-26!" },
  { id: "A-09", num: 9, name: "Priya Marlow", email: "priya@owners.example", role: "yacht-owner", password: "Tape-Measure-26!" },
];

export const CLOSURES = [
  "2026-01-01", "2026-04-03", "2026-04-06", "2026-05-04", "2026-05-25", "2026-08-31",
  "2026-12-25", "2026-12-28", "2027-01-01", "2027-03-26", "2027-03-29", "2027-05-03",
];

interface SeedRuleSet {
  version: number;
  effectiveAt: Date;
  seam: number;
  roach: number;
  tolerance: number;
  minWidth: number;
  minLength: number;
}

export const RULE_SETS: SeedRuleSet[] = [
  { version: 1, effectiveAt: new Date("2024-01-01T00:00:00Z"), seam: 20, roach: 1080, tolerance: 25, minWidth: 300, minLength: 500 },
  { version: 2, effectiveAt: new Date("2025-01-01T00:00:00Z"), seam: 18, roach: 1100, tolerance: 20, minWidth: 300, minLength: 600 },
  { version: 3, effectiveAt: new Date("2026-01-01T00:00:00Z"), seam: 15, roach: 1120, tolerance: 20, minWidth: 250, minLength: 600 },
  { version: 4, effectiveAt: new Date("2027-03-01T00:00:00Z"), seam: 15, roach: 1150, tolerance: 15, minWidth: 250, minLength: 500 },
];

interface SeedCloth {
  code: string;
  name: string;
  weight: string;
  width: number;
  usable: number;
  rate: number;
}

const WEIGHTS = ["3.8", "4.4", "5.0", "5.6", "6.2", "6.8", "7.4", "8.0", "8.6", "9.2", "9.8", "10.4"];

export const CLOTHS: SeedCloth[] = WEIGHTS.flatMap((weight, index) => {
  const rate = 4400 + 400 * index;
  const name = `Cruising crosscut ${weight} oz`;
  const code = (n: number) => `C-${String(n).padStart(2, "0")}`;
  return [
    { code: code(2 * index + 1), name, weight: `${weight} oz`, width: 914, usable: 900, rate },
    { code: code(2 * index + 2), name, weight: `${weight} oz`, width: 1372, usable: 1356, rate },
  ];
});

export interface SeedBoat {
  code: string;
  num: number;
  name: string;
  className: string;
  ownerId: string;
  ownerName: string;
  dims: Record<DimensionKey, number>;
}

const boat = (num: number, name: string, className: string, owner: [string, string], list: number[]): SeedBoat => ({
  code: `B-${String(num).padStart(2, "0")}`,
  num,
  name,
  className,
  ownerId: owner[0],
  ownerName: owner[1],
  dims: { I: list[0]!, J: list[1]!, P: list[2]!, E: list[3]!, LL: list[4]!, LP: list[5]! },
});

const MAREN: [string, string] = ["A-04", "Maren Holt"];
const TOBIAS: [string, string] = ["A-05", "Tobias Wren"];
const INES: [string, string] = ["A-06", "Ines Calder"];
const RAFE: [string, string] = ["A-07", "Rafe Okonkwo"];
const SAOIRSE: [string, string] = ["A-08", "Saoirse Lindqvist"];
const PRIYA: [string, string] = ["A-09", "Priya Marlow"];

export const SEED_BOATS: SeedBoat[] = [
  boat(1, "Kittiwake", "Halyard 32", MAREN, [12400, 3900, 11600, 3800, 12200, 5400]),
  boat(2, "Skerry Light", "Seabrook 27", MAREN, [10200, 3150, 9400, 3200, 9950, 4300]),
  boat(3, "Morwen", "Halyard 32", TOBIAS, [12380, 3900, 11640, 3780, 12180, 5400]),
  boat(4, "Tide Clerk", "Tamar 36", TOBIAS, [13900, 4300, 13100, 4400, 13650, 6000]),
  boat(5, "Shearwater", "Penwith 30", INES, [11300, 3600, 10600, 3500, 11050, 4900]),
  boat(6, "Gull Reach", "Lowen 34", INES, [13100, 4100, 12300, 4100, 12850, 5700]),
  boat(7, "Fairlead", "Carrick 29", RAFE, [10900, 3400, 10100, 3400, 10650, 4700]),
  boat(8, "Quiet Hour", "Tamar 36", RAFE, [13950, 4300, 13080, 4420, 13700, 6000]),
  boat(9, "Pellow", "Seabrook 27", SAOIRSE, [10180, 3150, 9420, 3200, 9930, 4300]),
  boat(10, "Lantic", "Penwith 30", SAOIRSE, [11320, 3600, 10580, 3500, 11070, 4900]),
  boat(11, "Wherry Ann", "Lowen 34", PRIYA, [13120, 4100, 12300, 4100, 12870, 5700]),
  boat(12, "Small Hours", "Carrick 29", PRIYA, [10880, 3400, 10120, 3400, 10630, 4700]),
];

interface SeedRoll {
  code: string;
  num: number;
  cloth: string;
  lot: string;
  width: number;
  usable: number;
  remaining: number;
  shelf: string;
}

const REMAINING = [28400, 24800, 21200, 17600, 14000, 32000, 35600, 10400, 39200, 6800, 26600, 23000, 19400, 3200, 15800, 12200];

export const ROLLS: SeedRoll[] = REMAINING.map((remaining, index) => {
  const num = index + 1;
  const cloth = CLOTHS.find((c) => c.code === `C-${String(num + 4).padStart(2, "0")}`)!;
  const ii = String(num).padStart(2, "0");
  return { code: `R-${ii}`, num, cloth: cloth.code, lot: `L-26${ii}`, width: cloth.width, usable: cloth.usable, remaining, shelf: num <= 8 ? "Rack A" : "Rack B" };
});

interface SeedOffcut {
  code: string;
  num: number;
  cloth: string;
  lot: string;
  width: number;
  usable: number;
  length: number;
}

const OFFCUT_FIGURES: [string, number, number, number][] = [
  ["C-05", 914, 900, 1800],
  ["C-06", 1372, 1356, 2400],
  ["C-07", 914, 900, 900],
  ["C-08", 1372, 1356, 1500],
  ["C-05", 600, 600, 2000],
  ["C-09", 914, 900, 3000],
  ["C-10", 1372, 1356, 700],
  ["C-12", 1372, 1356, 1200],
];

export const OFFCUTS: SeedOffcut[] = OFFCUT_FIGURES.map(([cloth, width, usable, length], index) => {
  const ii = String(index + 1).padStart(2, "0");
  return { code: `O-${ii}`, num: index + 1, cloth, lot: `L-25${ii}`, width, usable, length };
});

const run = (token: string, count: number): string => token.repeat(count);

/** A accepted, R rejected, V accepted then reversed, P pending; one string per owner in the order of the brief. */
export const SUBMISSION_SEQUENCES: string[] = [
  `${run("A", 5)}R${run("A", 15)}V${run("A", 2)}${run("P", 3)}`,
  `${run("A", 8)}R${run("A", 4)}R${run("A", 6)}${run("P", 3)}`,
  `${run("A", 12)}VV${run("A", 4)}R${run("A", 3)}${run("P", 2)}`,
  `R${run("A", 18)}${run("P", 2)}`,
  `${run("A", 5)}RR${run("A", 7)}${run("P", 2)}`,
  `${run("A", 3)}V${run("A", 4)}${run("P", 3)}`,
];
