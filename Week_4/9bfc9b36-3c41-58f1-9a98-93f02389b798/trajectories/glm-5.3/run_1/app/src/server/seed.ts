/** Every invented figure of the seeded loft, as the brief lists it. */

export interface SeedAccount {
  id: string;
  display_name: string;
  email: string;
  role: 'sailmaker' | 'loft-hand' | 'yacht-owner';
  password: string;
}

export const seedAccounts: SeedAccount[] = [
  { id: 'A-01', display_name: 'Morwenna Teague', email: 'morwenna@tabling.example', role: 'sailmaker', password: 'Loft-Bench-2026!' },
  { id: 'A-02', display_name: 'Jory Pascoe', email: 'jory@tabling.example', role: 'loft-hand', password: 'Cutting-Floor-26!' },
  { id: 'A-03', display_name: 'Kit Rowe', email: 'kit@tabling.example', role: 'loft-hand', password: 'Cutting-Floor-26!' },
  { id: 'A-04', display_name: 'Maren Holt', email: 'maren@owners.example', role: 'yacht-owner', password: 'Tape-Measure-26!' },
  { id: 'A-05', display_name: 'Tobias Wren', email: 'tobias@owners.example', role: 'yacht-owner', password: 'Tape-Measure-26!' },
  { id: 'A-06', display_name: 'Ines Calder', email: 'ines@owners.example', role: 'yacht-owner', password: 'Tape-Measure-26!' },
  { id: 'A-07', display_name: 'Rafe Okonkwo', email: 'rafe@owners.example', role: 'yacht-owner', password: 'Tape-Measure-26!' },
  { id: 'A-08', display_name: 'Saoirse Lindqvist', email: 'saoirse@owners.example', role: 'yacht-owner', password: 'Tape-Measure-26!' },
  { id: 'A-09', display_name: 'Priya Marlow', email: 'priya@owners.example', role: 'yacht-owner', password: 'Tape-Measure-26!' },
];

export const seedAuthorities = [
  { loft_hand: 'jory@tabling.example', valid_from: '2026-01-01T00:00:00Z', valid_until: null },
  { loft_hand: 'kit@tabling.example', valid_from: '2026-01-01T00:00:00Z', valid_until: '2026-06-30T00:00:00Z' },
];

export interface SeedRuleset {
  version: number;
  effective_at: string;
  seam_overlap_mm: number;
  roach_permille: number;
  tolerance_mm: number;
  min_offcut_width_mm: number;
  min_offcut_length_mm: number;
}

export const seedRulesets: SeedRuleset[] = [
  { version: 1, effective_at: '2024-01-01T00:00:00Z', seam_overlap_mm: 20, roach_permille: 1080, tolerance_mm: 25, min_offcut_width_mm: 300, min_offcut_length_mm: 500 },
  { version: 2, effective_at: '2025-01-01T00:00:00Z', seam_overlap_mm: 18, roach_permille: 1100, tolerance_mm: 20, min_offcut_width_mm: 300, min_offcut_length_mm: 600 },
  { version: 3, effective_at: '2026-01-01T00:00:00Z', seam_overlap_mm: 15, roach_permille: 1120, tolerance_mm: 20, min_offcut_width_mm: 250, min_offcut_length_mm: 600 },
  { version: 4, effective_at: '2027-03-01T00:00:00Z', seam_overlap_mm: 15, roach_permille: 1150, tolerance_mm: 15, min_offcut_width_mm: 250, min_offcut_length_mm: 500 },
];

export interface SeedCloth {
  code: string;
  weightOz: string;
  width: number;
  usable: number;
  rate: number;
}

export const seedCloths: SeedCloth[] = (() => {
  const weights = ['3.8', '4.4', '5.0', '5.6', '6.2', '6.8', '7.4', '8.0', '8.6', '9.2', '9.8', '10.4'];
  const out: SeedCloth[] = [];
  for (let k = 1; k <= 12; k++) {
    const w = weights[k - 1]!;
    const rate = 4400 + 400 * (k - 1);
    out.push({ code: pad2(2 * k - 1), weightOz: w, width: 914, usable: 900, rate });
    out.push({ code: pad2(2 * k), weightOz: w, width: 1372, usable: 1356, rate });
  }
  return out;
})();

export function clothName(weightOz: string): string {
  return `Cruising crosscut ${weightOz} oz`;
}

function pad2(n: number): string {
  return `C-${String(n).padStart(2, '0')}`;
}

export const seedClosures = [
  '2026-01-01', '2026-04-03', '2026-04-06', '2026-05-04', '2026-05-25', '2026-08-31',
  '2026-12-25', '2026-12-28', '2027-01-01', '2027-03-26', '2027-03-29', '2027-05-03',
];

export interface SeedBoat {
  code: string;
  name: string;
  class_name: string;
  owner: string;
  dims: { I: number; J: number; P: number; E: number; LL: number; LP: number };
}

const ownerByEmail: Record<string, string> = {
  'maren@owners.example': 'A-04',
  'tobias@owners.example': 'A-05',
  'ines@owners.example': 'A-06',
  'rafe@owners.example': 'A-07',
  'saoirse@owners.example': 'A-08',
  'priya@owners.example': 'A-09',
};

const boatRows: [string, string, string, string, number, number, number, number, number, number, number, number][] = [
  ['B-01', 'Kittiwake', 'Halyard 32', 'maren@owners.example', 12400, 3900, 11600, 3800, 12200, 5400, 0, 0],
  ['B-02', 'Skerry Light', 'Seabrook 27', 'maren@owners.example', 10200, 3150, 9400, 3200, 9950, 4300, 0, 0],
  ['B-03', 'Morwen', 'Halyard 32', 'tobias@owners.example', 12380, 3900, 11640, 3780, 12180, 5400, 0, 0],
  ['B-04', 'Tide Clerk', 'Tamar 36', 'tobias@owners.example', 13900, 4300, 13100, 4400, 13650, 6000, 0, 0],
  ['B-05', 'Shearwater', 'Penwith 30', 'ines@owners.example', 11300, 3600, 10600, 3500, 11050, 4900, 0, 0],
  ['B-06', 'Gull Reach', 'Lowen 34', 'ines@owners.example', 13100, 4100, 12300, 4100, 12850, 5700, 0, 0],
  ['B-07', 'Fairlead', 'Carrick 29', 'rafe@owners.example', 10900, 3400, 10100, 3400, 10650, 4700, 0, 0],
  ['B-08', 'Quiet Hour', 'Tamar 36', 'rafe@owners.example', 13950, 4300, 13080, 4420, 13700, 6000, 0, 0],
  ['B-09', 'Pellow', 'Seabrook 27', 'saoirse@owners.example', 10180, 3150, 9420, 3200, 9930, 4300, 0, 0],
  ['B-10', 'Lantic', 'Penwith 30', 'saoirse@owners.example', 11320, 3600, 10580, 3500, 11070, 4900, 0, 0],
  ['B-11', 'Wherry Ann', 'Lowen 34', 'priya@owners.example', 13120, 4100, 12300, 4100, 12870, 5700, 0, 0],
  ['B-12', 'Small Hours', 'Carrick 29', 'priya@owners.example', 10880, 3400, 10120, 3400, 10630, 4700, 0, 0],
];

export const seedBoats: SeedBoat[] = boatRows.map((r) => ({
  code: r[0] as string,
  name: r[1] as string,
  class_name: r[2] as string,
  owner: ownerByEmail[r[3] as string]!,
  dims: { I: r[4] as number, J: r[5] as number, P: r[6] as number, E: r[7] as number, LL: r[8] as number, LP: r[9] as number },
}));

/** Second sailmaker measurements that flag P as Remeasure on B-11 and B-12. */
export const seedRemeasurements = [
  { boat: 'B-11', dimension: 'P', value: 12345, on: '2026-10-29' },
  { boat: 'B-12', dimension: 'P', value: 10080, on: '2026-10-30' },
];

export interface SeedRoll {
  code: string;
  cloth: string;
  lot: string;
  width: number;
  usable: number;
  remaining: number;
  onHand: number;
  shelf: string;
}

const rollBase: [string, number][] = [
  ['R-01', 28400], ['R-02', 24800], ['R-03', 21200], ['R-04', 17600], ['R-05', 14000],
  ['R-06', 32000], ['R-07', 35600], ['R-08', 10400], ['R-09', 39200], ['R-10', 6800],
  ['R-11', 26600], ['R-12', 23000], ['R-13', 19400], ['R-14', 3200], ['R-15', 15800], ['R-16', 12200],
];

export const seedRolls: SeedRoll[] = rollBase.map(([code, remaining], i) => {
  const cloth = `C-${String(i + 5).padStart(2, '0')}`;
  const wide = (i + 5) % 2 === 0; // even cloth codes are 1372 wide
  const width = wide ? 1372 : 914;
  const usable = wide ? 1356 : 900;
  return {
    code,
    cloth,
    lot: `L-26${String(i + 1).padStart(2, '0')}`,
    width,
    usable,
    remaining,
    onHand: width * remaining,
    shelf: i < 8 ? 'Rack A' : 'Rack B',
  };
});

export interface SeedOffcut {
  code: string;
  cloth: string;
  lot: string;
  width: number;
  usable: number;
  length: number;
}

const offcutRows: [string, string, number, number, number][] = [
  ['O-01', 'C-05', 914, 900, 1800],
  ['O-02', 'C-06', 1372, 1356, 2400],
  ['O-03', 'C-07', 914, 900, 900],
  ['O-04', 'C-08', 1372, 1356, 1500],
  ['O-05', 'C-05', 600, 600, 2000],
  ['O-06', 'C-09', 914, 900, 3000],
  ['O-07', 'C-10', 1372, 1356, 700],
  ['O-08', 'C-12', 1372, 1356, 1200],
];

export const seedOffcuts: SeedOffcut[] = offcutRows.map((r) => ({
  code: r[0], cloth: r[1], lot: `L-25${r[0].slice(2)}`, width: r[2], usable: r[3], length: r[4],
}));

/** The 122 seeded submissions, with their sequences spelled out. */
export interface SeedSubmission {
  id: string;
  boat: string;
  owner: string; // account id
  dimension: 'I' | 'J' | 'P' | 'E';
  value: number;
  on: string;
  submittedAt: string;
  decidedAt: string;
  status: 'accepted' | 'rejected' | 'reversed' | 'pending';
  reason: string | null;
}

const ownerOrder: { id: string; firstBoat: string; dims: ('I' | 'J' | 'P' | 'E')[]; seq: string }[] = [
  { id: 'A-04', firstBoat: 'B-01', dims: ['I', 'J', 'P', 'E'], seq: 'AAAAAR' + 'A'.repeat(15) + 'V' + 'AA' + 'PPP' },
  { id: 'A-05', firstBoat: 'B-03', dims: ['I', 'J', 'P', 'E'], seq: 'A'.repeat(8) + 'R' + 'A'.repeat(4) + 'R' + 'A'.repeat(6) + 'PPP' },
  { id: 'A-06', firstBoat: 'B-05', dims: ['I', 'J', 'P', 'E'], seq: 'A'.repeat(12) + 'VV' + 'A'.repeat(4) + 'R' + 'A'.repeat(3) + 'PP' },
  { id: 'A-07', firstBoat: 'B-07', dims: ['I', 'J', 'P', 'E'], seq: 'R' + 'A'.repeat(18) + 'PP' },
  { id: 'A-08', firstBoat: 'B-09', dims: ['I', 'J', 'P', 'E'], seq: 'A'.repeat(5) + 'RR' + 'A'.repeat(7) + 'PP' },
  { id: 'A-09', firstBoat: 'B-11', dims: ['I', 'J', 'E'], seq: 'AAA' + 'V' + 'A'.repeat(4) + 'PPP' },
];

export function buildSeedSubmissions(boatDims: (boat: string, dim: string) => number): SeedSubmission[] {
  const out: SeedSubmission[] = [];
  let n = 0;
  ownerOrder.forEach((owner, oi) => {
    [...owner.seq].forEach((letter, k) => {
      n += 1;
      const dimension = owner.dims[(k) % owner.dims.length]!;
      const submitted = addDaysHours('2026-02-02T09:00:00Z', k, oi);
      const on = submitted.slice(0, 10);
      const value = boatDims(owner.firstBoat, dimension);
      const id = `S-${String(n).padStart(4, '0')}`;
      if (letter === 'P') {
        out.push({ id, boat: owner.firstBoat, owner: owner.id, dimension, value, on, submittedAt: submitted, decidedAt: '', status: 'pending', reason: null });
      } else if (letter === 'R') {
        out.push({ id, boat: owner.firstBoat, owner: owner.id, dimension, value, on, submittedAt: submitted, decidedAt: addHours(submitted, 2), status: 'rejected', reason: 'Figure taken to the wrong mark' });
      } else if (letter === 'V') {
        out.push({ id, boat: owner.firstBoat, owner: owner.id, dimension, value, on, submittedAt: submitted, decidedAt: addHours(submitted, 2), status: 'reversed', reason: 'Tape slipped on the black band' });
      } else {
        out.push({ id, boat: owner.firstBoat, owner: owner.id, dimension, value, on, submittedAt: submitted, decidedAt: addHours(submitted, 2), status: 'accepted', reason: null });
      }
    });
  });
  return out;
}

function addDaysHours(base: string, days: number, hours: number): string {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(d.getUTCHours() + hours);
  return d.toISOString().replace(/\.\d+Z$/, 'Z');
}

function addHours(base: string, hours: number): string {
  const d = new Date(base);
  d.setUTCHours(d.getUTCHours() + hours);
  return d.toISOString().replace(/\.\d+Z$/, 'Z');
}

/** The 240 seeded drawings, by the brief's numbering rules. */
export interface SeedDrawing {
  code: string;
  boat: string;
  sail: 'mainsail' | 'headsail';
  cloth: string;
  status: string;
  ruleset: number | null;
  assignedTo: string | null;
}

export function buildSeedDrawings(): SeedDrawing[] {
  const out: SeedDrawing[] = [];
  for (let n = 1; n <= 240; n++) {
    const code = `BR-${String(n).padStart(4, '0')}`;
    let boat: string;
    let sail: 'mainsail' | 'headsail';
    let cloth: string;
    if (n <= 230) {
      boat = `B-${String(((n - 1) % 10) + 1).padStart(2, '0')}`;
      sail = n % 2 === 1 ? 'mainsail' : 'headsail';
      cloth = n % 2 === 1 ? 'C-07' : 'C-06';
      if (n >= 141 && n <= 150) cloth = 'C-18';
    } else if (n <= 235) {
      boat = 'B-11';
      sail = 'mainsail';
      cloth = 'C-07';
    } else {
      boat = 'B-12';
      sail = 'mainsail';
      cloth = 'C-07';
    }
    let status: string;
    let ruleset: number | null;
    if (n <= 60) { status = 'issued'; ruleset = n <= 30 ? 2 : 3; }
    else if (n <= 70) { status = 'pending_store'; ruleset = 3; }
    else if (n <= 130) { status = 'cut'; ruleset = 3; }
    else if (n <= 190) { status = 'drawn'; ruleset = 3; }
    else if (n <= 230) { status = 'measuring'; ruleset = null; }
    else { status = 'remeasure'; ruleset = null; }
    const assignedTo = n >= 131 && n <= 150 ? 'A-02' : null;
    out.push({ code, boat, sail, cloth, status, ruleset, assignedTo });
  }
  return out;
}

export interface SeedGrant {
  id: string;
  drawing: string;
  owner: string; // account id
  grantedAt: string;
  withdrawnAt: string | null;
}

export function buildSeedGrants(): SeedGrant[] {
  const out: SeedGrant[] = [];
  for (let n = 1; n <= 60; n++) {
    const drawing = `BR-${String(n).padStart(4, '0')}`;
    const boatCode = `B-${String(((n - 1) % 10) + 1).padStart(2, '0')}`;
    const boat = seedBoats.find((b) => b.code === boatCode)!;
    out.push({
      id: `G-${String(n).padStart(4, '0')}`,
      drawing,
      owner: boat.owner,
      grantedAt: '2026-07-01T09:00:00Z',
      withdrawnAt: n === 10 ? '2026-08-01T09:00:00Z' : null,
    });
  }
  return out;
}

/** The pending submission ids, listed in the brief. */
export const seedPendingIds = [
  'S-0025', 'S-0026', 'S-0027', 'S-0048', 'S-0049', 'S-0050', 'S-0073', 'S-0074',
  'S-0094', 'S-0095', 'S-0110', 'S-0111', 'S-0120', 'S-0121', 'S-0122',
];

/** Pair p of the 600 seeded ledger pairs is posted at this instant. */
export function seedPairPostedAt(p: number): string {
  const base = new Date('2026-03-02T08:00:00Z');
  base.setUTCHours(base.getUTCHours() + (p - 1) * 4);
  return base.toISOString().replace(/\.\d+Z$/, 'Z');
}
