import { config } from '../config';
import { sailAreaView, usedDimensions, luffAndFoot, type SailKind } from '../domain/areas';
import { buildPanels, type PanelGeometry, type Point } from '../domain/panels';
import { firstFit, outlineBounds, placedOutline, type LaidOutline, type Rotation } from '../domain/nest';
import { renderCutSheet, type CutSheetInput } from '../domain/cutsheet';
import { CUT_SHEET_CONTENT_TYPE, cutSheetKey } from '../services/store';
import { sha256OfBytes } from '../services/s3';
import type { Transaction } from './pool';

/** The seeded loft. Seeding happens on serve, exactly once per database. */

export const DIMENSION_KEYS = ['I', 'J', 'P', 'E', 'LL', 'LP'] as const;
export type DimensionKey = (typeof DIMENSION_KEYS)[number];

export interface SeedAccount {
  readonly id: string;
  readonly display_name: string;
  readonly email: string;
  readonly role: 'sailmaker' | 'loft-hand' | 'yacht-owner';
  readonly password: string;
}

export const SEED_ACCOUNTS: readonly SeedAccount[] = [
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

const CLOTH_WEIGHTS = ['3.8', '4.4', '5.0', '5.6', '6.2', '6.8', '7.4', '8.0', '8.6', '9.2', '9.8', '10.4'] as const;

export interface SeedCloth {
  readonly code: string;
  readonly name: string;
  readonly weight: string;
  readonly width_mm: number;
  readonly usable_width_mm: number;
  readonly rate_pence_per_m2: number;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

export const SEED_CLOTHS: readonly SeedCloth[] = CLOTH_WEIGHTS.flatMap((weight, index) => {
  const k = index + 1;
  const rate = 4400 + 400 * (k - 1);
  const name = `Cruising crosscut ${weight} oz`;
  return [
    { code: `C-${pad(2 * k - 1, 2)}`, name, weight: `${weight} oz`, width_mm: 914, usable_width_mm: 900, rate_pence_per_m2: rate },
    { code: `C-${pad(2 * k, 2)}`, name, weight: `${weight} oz`, width_mm: 1372, usable_width_mm: 1356, rate_pence_per_m2: rate },
  ];
});

export const SEED_CLOSURES: readonly string[] = [
  '2026-01-01', '2026-04-03', '2026-04-06', '2026-05-04', '2026-05-25', '2026-08-31',
  '2026-12-25', '2026-12-28', '2027-01-01', '2027-03-26', '2027-03-29', '2027-05-03',
];

export interface SeedRuleSet {
  readonly version: number;
  readonly effective_at: string;
  readonly seam_overlap_mm: number;
  readonly roach_permille: number;
  readonly tolerance_mm: number;
  readonly min_offcut_width_mm: number;
  readonly min_offcut_length_mm: number;
}

export const SEED_RULESETS: readonly SeedRuleSet[] = [
  { version: 1, effective_at: '2024-01-01T00:00:00Z', seam_overlap_mm: 20, roach_permille: 1080, tolerance_mm: 25, min_offcut_width_mm: 300, min_offcut_length_mm: 500 },
  { version: 2, effective_at: '2025-01-01T00:00:00Z', seam_overlap_mm: 18, roach_permille: 1100, tolerance_mm: 20, min_offcut_width_mm: 300, min_offcut_length_mm: 600 },
  { version: 3, effective_at: '2026-01-01T00:00:00Z', seam_overlap_mm: 15, roach_permille: 1120, tolerance_mm: 20, min_offcut_width_mm: 250, min_offcut_length_mm: 600 },
  { version: 4, effective_at: '2027-03-01T00:00:00Z', seam_overlap_mm: 15, roach_permille: 1150, tolerance_mm: 15, min_offcut_width_mm: 250, min_offcut_length_mm: 500 },
];

interface SeedBoat {
  readonly code: string;
  readonly name: string;
  readonly class_name: string;
  readonly owner_email: string;
  readonly values: Readonly<Record<DimensionKey, number>>;
}

function boat(code: string, name: string, className: string, owner: string, figures: readonly number[]): SeedBoat {
  const values = {} as Record<DimensionKey, number>;
  DIMENSION_KEYS.forEach((key, index) => {
    values[key] = figures[index] as number;
  });
  return { code, name, class_name: className, owner_email: owner, values };
}

const MAREN = 'maren@owners.example';
const TOBIAS = 'tobias@owners.example';
const INES = 'ines@owners.example';
const RAFE = 'rafe@owners.example';
const SAOIRSE = 'saoirse@owners.example';
const PRIYA = 'priya@owners.example';
const SAILMAKER = 'morwenna@tabling.example';

export const SEED_BOATS: readonly SeedBoat[] = [
  boat('B-01', 'Kittiwake', 'Halyard 32', MAREN, [12400, 3900, 11600, 3800, 12200, 5400]),
  boat('B-02', 'Skerry Light', 'Seabrook 27', MAREN, [10200, 3150, 9400, 3200, 9950, 4300]),
  boat('B-03', 'Morwen', 'Halyard 32', TOBIAS, [12380, 3900, 11640, 3780, 12180, 5400]),
  boat('B-04', 'Tide Clerk', 'Tamar 36', TOBIAS, [13900, 4300, 13100, 4400, 13650, 6000]),
  boat('B-05', 'Shearwater', 'Penwith 30', INES, [11300, 3600, 10600, 3500, 11050, 4900]),
  boat('B-06', 'Gull Reach', 'Lowen 34', INES, [13100, 4100, 12300, 4100, 12850, 5700]),
  boat('B-07', 'Fairlead', 'Carrick 29', RAFE, [10900, 3400, 10100, 3400, 10650, 4700]),
  boat('B-08', 'Quiet Hour', 'Tamar 36', RAFE, [13950, 4300, 13080, 4420, 13700, 6000]),
  boat('B-09', 'Pellow', 'Seabrook 27', SAOIRSE, [10180, 3150, 9420, 3200, 9930, 4300]),
  boat('B-10', 'Lantic', 'Penwith 30', SAOIRSE, [11320, 3600, 10580, 3500, 11070, 4900]),
  boat('B-11', 'Wherry Ann', 'Lowen 34', PRIYA, [13120, 4100, 12300, 4100, 12870, 5700]),
  boat('B-12', 'Small Hours', 'Carrick 29', PRIYA, [10880, 3400, 10120, 3400, 10630, 4700]),
];

const ROLL_REMAINING: readonly number[] = [
  28400, 24800, 21200, 17600, 14000, 32000, 35600, 10400,
  39200, 6800, 26600, 23000, 19400, 3200, 15800, 12200,
];

interface SeedOffcut {
  readonly code: string;
  readonly cloth_code: string;
  readonly width_mm: number;
  readonly usable_width_mm: number;
  readonly length_mm: number;
}

const SEED_OFFCUTS: readonly SeedOffcut[] = [
  { code: 'O-01', cloth_code: 'C-05', width_mm: 914, usable_width_mm: 900, length_mm: 1800 },
  { code: 'O-02', cloth_code: 'C-06', width_mm: 1372, usable_width_mm: 1356, length_mm: 2400 },
  { code: 'O-03', cloth_code: 'C-07', width_mm: 914, usable_width_mm: 900, length_mm: 900 },
  { code: 'O-04', cloth_code: 'C-08', width_mm: 1372, usable_width_mm: 1356, length_mm: 1500 },
  { code: 'O-05', cloth_code: 'C-05', width_mm: 600, usable_width_mm: 600, length_mm: 2000 },
  { code: 'O-06', cloth_code: 'C-09', width_mm: 914, usable_width_mm: 900, length_mm: 3000 },
  { code: 'O-07', cloth_code: 'C-10', width_mm: 1372, usable_width_mm: 1356, length_mm: 700 },
  { code: 'O-08', cloth_code: 'C-12', width_mm: 1372, usable_width_mm: 1356, length_mm: 1200 },
];

/** A = accepted, R = rejected, V = accepted then reversed, P = pending. */
const SUBMISSION_SEQUENCES: readonly { readonly email: string; readonly boat: string; readonly dimensions: readonly DimensionKey[]; readonly sequence: string }[] = [
  { email: MAREN, boat: 'B-01', dimensions: ['I', 'J', 'P', 'E'], sequence: 'AAAAARAAAAAAAAAAAAAAAVAAPPP' },
  { email: TOBIAS, boat: 'B-03', dimensions: ['I', 'J', 'P', 'E'], sequence: 'AAAAAAAARAAAARAAAAAAPPP' },
  { email: INES, boat: 'B-05', dimensions: ['I', 'J', 'P', 'E'], sequence: 'AAAAAAAAAAAAVVAAAARAAAPP' },
  { email: RAFE, boat: 'B-07', dimensions: ['I', 'J', 'P', 'E'], sequence: 'RAAAAAAAAAAAAAAAAAAPP' },
  { email: SAOIRSE, boat: 'B-09', dimensions: ['I', 'J', 'P', 'E'], sequence: 'AAAAARRAAAAAAAPP' },
  { email: PRIYA, boat: 'B-11', dimensions: ['I', 'J', 'E'], sequence: 'AAAVAAAAPPP' },
];

const REJECT_REASON = 'Figure taken to the wrong mark';
const REVERSE_REASON = 'Tape slipped on the black band';

const LEDGER_START_MS = Date.parse('2026-03-02T08:00:00Z');
const PAIR_STEP_MS = 4 * 3600 * 1000;

function instant(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

interface SeedDrawing {
  readonly code: string;
  readonly boat_code: string;
  readonly sail: SailKind;
  readonly cloth_code: string;
  readonly status: string;
  readonly ruleset_version: number | null;
  readonly assigned_to: string | null;
}

function seedDrawings(): SeedDrawing[] {
  const drawings: SeedDrawing[] = [];
  for (let n = 1; n <= 240; n += 1) {
    const code = `BR-${pad(n, 4)}`;
    let boatCode: string;
    let sail: SailKind;
    let clothCode: string;
    if (n <= 230) {
      boatCode = `B-${pad(((n - 1) % 10) + 1, 2)}`;
      sail = n % 2 === 1 ? 'mainsail' : 'headsail';
      clothCode = n % 2 === 1 ? 'C-07' : 'C-06';
    } else {
      boatCode = n <= 235 ? 'B-11' : 'B-12';
      sail = 'mainsail';
      clothCode = 'C-07';
    }
    if (n >= 141 && n <= 150) clothCode = 'C-18';

    let status: string;
    let version: number | null;
    if (n <= 60) {
      status = 'pending_store';
      version = n <= 30 ? 2 : 3;
    } else if (n <= 70) {
      status = 'pending_store';
      version = 3;
    } else if (n <= 130) {
      status = 'cut';
      version = 3;
    } else if (n <= 190) {
      status = 'drawn';
      version = 3;
    } else if (n <= 230) {
      status = 'measuring';
      version = null;
    } else {
      status = 'remeasure';
      version = null;
    }
    drawings.push({
      code,
      boat_code: boatCode,
      sail,
      cloth_code: clothCode,
      status,
      ruleset_version: version,
      assigned_to: n >= 131 && n <= 150 ? 'jory@tabling.example' : null,
    });
  }
  return drawings;
}

async function insert(tx: Transaction, sql: string, values: readonly unknown[]): Promise<void> {
  await tx.query(sql, values);
}

/**
 * Writes the seeded loft. Every seeded Issued and Pending store drawing is laid
 * down as `pending_store` with its cut sheet's key, length and digest; the issuer
 * confirms them against the store and moves them on, with no job and no restart.
 */
export async function applySeed(tx: Transaction): Promise<void> {
  const clothByCode = new Map(SEED_CLOTHS.map((cloth) => [cloth.code, cloth]));
  const boatByCode = new Map(SEED_BOATS.map((item) => [item.code, item]));
  const accountByEmail = new Map(SEED_ACCOUNTS.map((item) => [item.email, item]));
  const rulesetByVersion = new Map(SEED_RULESETS.map((item) => [item.version, item]));

  for (const account of SEED_ACCOUNTS) {
    await insert(
      tx,
      `INSERT INTO account (id, email, display_name, role, seeded_password) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO NOTHING`,
      [account.id, account.email, account.display_name, account.role, account.password],
    );
  }

  for (const cloth of SEED_CLOTHS) {
    await insert(
      tx,
      `INSERT INTO cloth (code, name, weight, width_mm, usable_width_mm, rate_pence_per_m2)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (code) DO NOTHING`,
      [cloth.code, cloth.name, cloth.weight, cloth.width_mm, cloth.usable_width_mm, cloth.rate_pence_per_m2],
    );
  }

  for (const closure of SEED_CLOSURES) {
    await insert(tx, 'INSERT INTO closure (closed_on) VALUES ($1) ON CONFLICT DO NOTHING', [closure]);
  }

  for (const ruleset of SEED_RULESETS) {
    await insert(
      tx,
      `INSERT INTO ruleset (version, effective_at, seam_overlap_mm, roach_permille, tolerance_mm,
         min_offcut_width_mm, min_offcut_length_mm, revision)
       VALUES ($1,$2,$3,$4,$5,$6,$7,1) ON CONFLICT (version) DO NOTHING`,
      [ruleset.version, ruleset.effective_at, ruleset.seam_overlap_mm, ruleset.roach_permille,
        ruleset.tolerance_mm, ruleset.min_offcut_width_mm, ruleset.min_offcut_length_mm],
    );
  }

  for (const item of SEED_BOATS) {
    await insert(
      tx,
      `INSERT INTO boat (code, name, class_name, owner_email, notes, revision)
       VALUES ($1,$2,$3,$4,'',1) ON CONFLICT (code) DO NOTHING`,
      [item.code, item.name, item.class_name, item.owner_email],
    );
    for (const key of DIMENSION_KEYS) {
      await insert(
        tx,
        `INSERT INTO measurement (id, boat_code, dimension, value_mm, measured_on, source, tolerance_mm)
         VALUES ($1,$2,$3,$4,'2026-01-15','sailmaker',20) ON CONFLICT (id) DO NOTHING`,
        [`M-${item.code}-${key}-1`, item.code, key, item.values[key]],
      );
    }
  }

  // The two seeded dimensions that sit outside their band.
  await insert(
    tx,
    `INSERT INTO measurement (id, boat_code, dimension, value_mm, measured_on, source, tolerance_mm)
     VALUES ('M-B-11-P-2','B-11','P',12345,'2026-10-29','sailmaker',20) ON CONFLICT (id) DO NOTHING`,
    [],
  );
  await insert(
    tx,
    `INSERT INTO measurement (id, boat_code, dimension, value_mm, measured_on, source, tolerance_mm)
     VALUES ('M-B-12-P-2','B-12','P',10080,'2026-10-30','sailmaker',20) ON CONFLICT (id) DO NOTHING`,
    [],
  );

  // Cutting authorities.
  await insert(
    tx,
    `INSERT INTO authority (id, loft_hand_email, valid_from, valid_until)
     VALUES ('AU-01','jory@tabling.example','2026-01-01T00:00:00Z',NULL) ON CONFLICT (id) DO NOTHING`,
    [],
  );
  await insert(
    tx,
    `INSERT INTO authority (id, loft_hand_email, valid_from, valid_until)
     VALUES ('AU-02','kit@tabling.example','2026-01-01T00:00:00Z','2026-06-30T00:00:00Z')
     ON CONFLICT (id) DO NOTHING`,
    [],
  );

  // Submissions, owner by owner, with their measurements where accepted.
  let submissionNumber = 0;
  for (let ownerIndex = 0; ownerIndex < SUBMISSION_SEQUENCES.length; ownerIndex += 1) {
    const plan = SUBMISSION_SEQUENCES[ownerIndex] as (typeof SUBMISSION_SEQUENCES)[number];
    const ownerBoat = boatByCode.get(plan.boat) as SeedBoat;
    for (let k = 1; k <= plan.sequence.length; k += 1) {
      submissionNumber += 1;
      const id = `S-${pad(submissionNumber, 4)}`;
      const mark = plan.sequence[k - 1] as string;
      const dimension = plan.dimensions[(k - 1) % plan.dimensions.length] as DimensionKey;
      const submittedMs =
        Date.parse('2026-02-02T09:00:00Z') + (k - 1) * 86400000 + ownerIndex * 3600000;
      const submittedAt = instant(submittedMs);
      const decidedAt = mark === 'P' ? null : instant(submittedMs + 2 * 3600000);
      const measuredOn = submittedAt.slice(0, 10);
      const valueMm = ownerBoat.values[dimension];
      const status = mark === 'A' ? 'accepted' : mark === 'R' ? 'rejected' : mark === 'V' ? 'reversed' : 'pending';
      const reason = mark === 'R' ? REJECT_REASON : mark === 'V' ? REVERSE_REASON : null;
      await insert(
        tx,
        `INSERT INTO submission (id, boat_code, dimension, value_mm, as_submitted, measured_on, note,
           status, submitted_by, submitted_at, decided_at, decided_by, reason)
         VALUES ($1,$2,$3,$4,$5,$6,'',$7,$8,$9,$10,$11,$12) ON CONFLICT (id) DO NOTHING`,
        [id, plan.boat, dimension, valueMm, `${valueMm} mm`, measuredOn, status, plan.email,
          submittedAt, decidedAt, mark === 'P' ? null : SAILMAKER, reason],
      );
      if (status === 'accepted') {
        await insert(
          tx,
          `INSERT INTO measurement (id, boat_code, dimension, value_mm, measured_on, source, submission_id, tolerance_mm)
           VALUES ($1,$2,$3,$4,$5,'submission',$6,20) ON CONFLICT (id) DO NOTHING`,
          [`M-${id}`, plan.boat, dimension, valueMm, measuredOn, id],
        );
      }
    }
  }

  // Rolls and offcuts.
  for (let i = 1; i <= 16; i += 1) {
    const code = `R-${pad(i, 2)}`;
    const cloth = clothByCode.get(`C-${pad(i + 4, 2)}`) as SeedCloth;
    const remaining = ROLL_REMAINING[i - 1] as number;
    await insert(
      tx,
      `INSERT INTO stock (code, kind, cloth_code, lot, width_mm, usable_width_mm, remaining_mm,
         on_hand_mm2, shelf_location, note, revision)
       VALUES ($1,'roll',$2,$3,$4,$5,$6,$7,$8,'',1) ON CONFLICT (code) DO NOTHING`,
      [code, cloth.code, `L-26${pad(i, 2)}`, cloth.width_mm, cloth.usable_width_mm, remaining,
        cloth.width_mm * remaining, i <= 8 ? 'Rack A' : 'Rack B'],
    );
  }
  for (let i = 1; i <= SEED_OFFCUTS.length; i += 1) {
    const offcut = SEED_OFFCUTS[i - 1] as SeedOffcut;
    await insert(
      tx,
      `INSERT INTO stock (code, kind, cloth_code, lot, width_mm, usable_width_mm, remaining_mm,
         on_hand_mm2, shelf_location, note, revision)
       VALUES ($1,'offcut',$2,$3,$4,$5,$6,$7,'Offcut bin','',1) ON CONFLICT (code) DO NOTHING`,
      [offcut.code, offcut.cloth_code, `L-25${pad(i, 2)}`, offcut.width_mm, offcut.usable_width_mm,
        offcut.length_mm, offcut.width_mm * offcut.length_mm],
    );
  }

  // The ledger: 600 pairs, 1200 lines.
  for (let p = 1; p <= 600; p += 1) {
    const postedAt = instant(LEDGER_START_MS + (p - 1) * PAIR_STEP_MS);
    const pairId = `P-${pad(p, 4)}`;
    let stockCode: string;
    let stockAmount: number;
    let counterAccount: string;
    let reason: string;
    if (p <= 16) {
      const cloth = clothByCode.get(`C-${pad(p + 4, 2)}`) as SeedCloth;
      stockCode = `R-${pad(p, 2)}`;
      stockAmount = cloth.width_mm * 50000;
      counterAccount = 'supplier-receipt';
      reason = 'Received, full roll';
    } else if (p <= 24) {
      const offcut = SEED_OFFCUTS[p - 17] as SeedOffcut;
      stockCode = offcut.code;
      stockAmount = offcut.width_mm * offcut.length_mm;
      counterAccount = 'opening-stock';
      reason = 'Opening count';
    } else {
      const j = p - 25;
      const rollIndex = (j % 16) + 1;
      const cloth = clothByCode.get(`C-${pad(rollIndex + 4, 2)}`) as SeedCloth;
      const remaining = ROLL_REMAINING[rollIndex - 1] as number;
      const c = (50000 - remaining) / 36;
      stockCode = `R-${pad(rollIndex, 2)}`;
      stockAmount = -(cloth.width_mm * c);
      counterAccount = 'imported-history';
      reason = 'Imported from spreadsheet';
    }
    await insert(
      tx,
      `INSERT INTO ledger_line (line_id, pair_id, posted_at, account, amount_mm2, stock_code, drawing_code, actor_email, reason)
       VALUES ($1,$2,$3,$4,$5,$6,'',$7,$8) ON CONFLICT (line_id) DO NOTHING`,
      [2 * p - 1, pairId, postedAt, stockCode, stockAmount, stockCode, SAILMAKER, reason],
    );
    await insert(
      tx,
      `INSERT INTO ledger_line (line_id, pair_id, posted_at, account, amount_mm2, stock_code, drawing_code, actor_email, reason)
       VALUES ($1,$2,$3,$4,$5,$6,'',$7,$8) ON CONFLICT (line_id) DO NOTHING`,
      [2 * p, pairId, postedAt, counterAccount, -stockAmount, stockCode, SAILMAKER, reason],
    );
  }

  // Drawings, their panels and the imported Cut claims.
  const drawings = seedDrawings();
  for (const drawing of drawings) {
    const number = Number(drawing.code.slice(3));
    const item = boatByCode.get(drawing.boat_code) as SeedBoat;
    const cloth = clothByCode.get(drawing.cloth_code) as SeedCloth;
    const owner = accountByEmail.get(item.owner_email) as SeedAccount;
    const ruleset = drawing.ruleset_version === null ? null : (rulesetByVersion.get(drawing.ruleset_version) as SeedRuleSet);

    let panels: PanelGeometry[] = [];
    let areaMm2: number | null = null;
    let basis: string | null = null;
    let luffMm: number | null = null;
    let footMm: number | null = null;
    let drawDimensions: { key: string; value_mm: number }[] | null = null;

    if (ruleset !== null) {
      const keys = usedDimensions(drawing.sail);
      drawDimensions = keys.map((key) => ({ key, value_mm: item.values[key as DimensionKey] }));
      const figures = luffAndFoot(drawing.sail, item.values);
      luffMm = figures.luffMm;
      footMm = figures.footMm;
      const area = sailAreaView(drawing.sail, item.values, ruleset.roach_permille, ruleset.tolerance_mm, ruleset.version);
      areaMm2 = area.area_mm2;
      basis = area.basis;
      panels = buildPanels(figures.luffMm, figures.footMm, cloth.usable_width_mm - ruleset.seam_overlap_mm);
    }

    await insert(
      tx,
      `INSERT INTO drawing (code, boat_code, sail, cloth_code, status, ruleset_version, assigned_to,
         luff_mm, foot_mm, area_mm2, area_basis, draw_boat_name, draw_owner_name, draw_dimensions)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (code) DO NOTHING`,
      [drawing.code, drawing.boat_code, drawing.sail, drawing.cloth_code, drawing.status,
        drawing.ruleset_version, drawing.assigned_to, luffMm, footMm, areaMm2, basis,
        ruleset === null ? null : item.name, ruleset === null ? null : owner.display_name,
        drawDimensions === null ? null : JSON.stringify(drawDimensions)],
    );

    const isCutClaim = number <= 130;
    for (const panel of panels) {
      await insert(
        tx,
        `INSERT INTO panel (drawing_code, number, outline, length_mm, width_mm, area_mm2, cut)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (drawing_code, number) DO NOTHING`,
        [drawing.code, panel.number, JSON.stringify(panel.outline), panel.length_mm, panel.width_mm,
          panel.area_mm2, isCutClaim],
      );
    }

    if (!isCutClaim || ruleset === null) continue;

    const stockCode = drawing.sail === 'mainsail' ? 'R-03' : 'R-02';
    const stockWidth = drawing.sail === 'mainsail' ? 914 : 1372;
    const stockUsable = drawing.sail === 'mainsail' ? 900 : 1356;
    const stockLot = drawing.sail === 'mainsail' ? 'L-2603' : 'L-2602';
    const laid: LaidOutline[] = [];
    const placements: { panel: PanelGeometry; placement: { x_mm: number; y_mm: number; rotation: Rotation } }[] = [];
    for (const panel of panels) {
      const placement = firstFit(panel, laid, 50000, stockUsable);
      if (placement === null) continue;
      const outline = placedOutline(panel, placement.rotation, placement.x_mm, placement.y_mm);
      laid.push({ panel_number: panel.number, outline });
      placements.push({ panel, placement });
    }
    const usedMm = laid.reduce((most, entry) => Math.max(most, outlineBounds(entry.outline).maxX), 0);
    const takenAt = instant(Date.parse('2026-04-01T08:00:00Z') + number * 3600000);
    const claimId = `CL-SEED-${pad(number, 4)}`;
    await insert(
      tx,
      `INSERT INTO claim (id, stock_code, drawing_code, holder_email, length_mm, status, taken_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,'cut',$6,$7) ON CONFLICT (id) DO NOTHING`,
      [claimId, stockCode, drawing.code, SAILMAKER, usedMm, takenAt,
        instant(Date.parse(takenAt) + config.claimHoldSeconds * 1000)],
    );
    for (const entry of placements) {
      await insert(
        tx,
        `INSERT INTO lay (claim_id, panel_number, x_mm, y_mm, rotation)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (claim_id, panel_number) DO NOTHING`,
        [claimId, entry.panel.number, entry.placement.x_mm, entry.placement.y_mm, entry.placement.rotation],
      );
    }

    if (number > 70) continue;

    const sheet: CutSheetInput = {
      drawing_code: drawing.code,
      boat_name: item.name,
      sail: drawing.sail,
      owner_display_name: owner.display_name,
      cloth_code: cloth.code,
      cloth_name: cloth.name,
      usable_width_mm: cloth.usable_width_mm,
      dimensions: drawDimensions as { key: string; value_mm: number }[],
      area_mm2: areaMm2 as number,
      area_basis: basis as string,
      seam_overlap_mm: ruleset.seam_overlap_mm,
      tolerance_mm: ruleset.tolerance_mm,
      ruleset_version: ruleset.version,
      panels: panels.map((panel) => ({
        number: panel.number,
        length_mm: panel.length_mm,
        width_mm: panel.width_mm,
        area_mm2: panel.area_mm2,
        outline: panel.outline,
      })),
      nests: [
        {
          stock_code: stockCode,
          used_mm: usedMm,
          width_mm: stockWidth,
          lot: stockLot,
          outlines: laid.map((entry) => ({ panel_number: entry.panel_number, outline: entry.outline as readonly Point[] })),
        },
      ],
      predecessor: null,
    };
    const bytes = renderCutSheet(sheet);
    const digest = sha256OfBytes(bytes);
    const key = cutSheetKey(drawing.code, digest);
    await tx.query(
      `UPDATE drawing SET cut_sheet_sha256 = $2, cut_sheet_size = $3, cut_sheet_key = $4 WHERE code = $1`,
      [drawing.code, digest, bytes.length, key],
    );

  }

  // Sight grants.
  for (let n = 1; n <= 60; n += 1) {
    const drawingCode = `BR-${pad(n, 4)}`;
    const drawing = drawings[n - 1] as SeedDrawing;
    const item = boatByCode.get(drawing.boat_code) as SeedBoat;
    const withdrawn = n === 10;
    await insert(
      tx,
      `INSERT INTO sight_grant (id, drawing_code, owner_email, status, granted_at, ends_at, withdrawn_at)
       VALUES ($1,$2,$3,$4,'2026-07-01T09:00:00Z',NULL,$5) ON CONFLICT (id) DO NOTHING`,
      [`G-${pad(n, 4)}`, drawingCode, item.owner_email, withdrawn ? 'withdrawn' : 'granted',
        withdrawn ? '2026-08-01T09:00:00Z' : null],
    );
  }

  // Each sequence continues the seeded codes.
  const sequences: readonly [string, number][] = [
    ['boat', 13], ['drawing', 241], ['roll', 17], ['offcut', 9],
    ['submission', 123], ['grant', 61], ['account', 10], ['ledger_line', 1201],
  ];
  for (const [name, next] of sequences) {
    await insert(
      tx,
      'INSERT INTO code_sequence (name, next_value) VALUES ($1,$2) ON CONFLICT (name) DO NOTHING',
      [name, next],
    );
  }

  await insert(tx, `INSERT INTO app_meta (key, value) VALUES ('seeded','1') ON CONFLICT (key) DO NOTHING`, []);
}
