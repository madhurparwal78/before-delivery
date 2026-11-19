import type { DbClient } from './db.ts';
import { crosscutPanels, foretriangleArea, sailArea, type PanelShape } from '../domain/sail.ts';
import { buildSeedDrawings, buildSeedGrants, buildSeedSubmissions, clothName, seedAccounts, seedAuthorities, seedBoats, seedClosures, seedCloths, seedOffcuts, seedPendingIds, seedRemeasurements, seedRolls, seedRulesets, seedPairPostedAt, type SeedDrawing } from './seed.ts';
import { opaqueId } from './util.ts';

export interface SeedDeps {
  renderCutSheet: (drawing: SeedDrawingView) => string;
  storePutConfirmed: (key: string, bytes: Buffer) => Promise<boolean>;
}

export interface SeedDrawingView {
  code: string;
  boatName: string;
  sail: 'mainsail' | 'headsail';
  ownerName: string;
  clothCode: string;
  clothName: string;
  usableWidth: number;
  catalogueWidth: number;
  rulesetVersion: number;
  dims: { key: string; value_mm: number }[];
  areaMm2: number;
  panels: PanelShape[];
  seamOverlap: number;
  tolerance: number;
  roach: number;
  predecessor: string | null;
  nests: { stock: string; used: number; width: number; lot: string; panelOutlines: [number, number][][] }[];
}

const DRAW_BASE = { seamOverlap: 15, tolerance: 20, roach: 1120 };

/** The pinned rule-set figures of a seeded drawing, by its version. */
function seedRules(d: SeedDrawing): { seamOverlap: number; tolerance: number; roach: number; version: number } {
  const v = d.ruleset;
  const rs = seedRulesets.find((r) => r.version === v);
  if (!rs) return { ...DRAW_BASE, version: 3 };
  return { seamOverlap: rs.seam_overlap_mm, tolerance: rs.tolerance_mm, roach: rs.roach_permille, version: rs.version };
}

/** Seed the whole loft once. The caller holds the database boot lock. */
export async function seedLoft(db: DbClient, deps: SeedDeps): Promise<void> {
  const clothUsable = new Map(seedCloths.map((c) => [c.code, c.usable]));

  for (const a of seedAccounts) {
    await db.query(
      `INSERT INTO accounts (id, email_norm, display_name, role, kc_user_id, deleted, created_at)
       VALUES ($1,$2,$3,$4,null,false,now()) ON CONFLICT (id) DO NOTHING`,
      [a.id, a.email, a.display_name, a.role],
    );
  }
  for (const c of seedCloths) {
    await db.query(
      `INSERT INTO cloths (code,name,weight,width_mm,usable_width_mm,rate_pence_per_m2)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (code) DO NOTHING`,
      [c.code, clothName(c.weightOz), `${c.weightOz} oz`, c.width, c.usable, c.rate],
    );
  }
  for (const d of seedClosures) {
    await db.query(`INSERT INTO closures (date) VALUES ($1) ON CONFLICT (date) DO NOTHING`, [d]);
  }
  for (const r of seedRulesets) {
    await db.query(
      `INSERT INTO rulesets (version,effective_at,seam_overlap_mm,roach_permille,tolerance_mm,min_offcut_width_mm,min_offcut_length_mm,revision)
       VALUES ($1,$2,$3,$4,$5,$6,$7,1) ON CONFLICT (version) DO NOTHING`,
      [r.version, r.effective_at, r.seam_overlap_mm, r.roach_permille, r.tolerance_mm, r.min_offcut_width_mm, r.min_offcut_length_mm],
    );
  }
  for (const au of seedAuthorities) {
    await db.query(
      `INSERT INTO authorities (id, loft_hand_id, valid_from, valid_until, withdrawn_at)
       VALUES ($1,(SELECT id FROM accounts WHERE email_norm=$2),$3,$4,null) ON CONFLICT DO NOTHING`,
      [opaqueId('auth'), au.loft_hand, au.valid_from, au.valid_until],
    );
  }
  for (const b of seedBoats) {
    await db.query(
      `INSERT INTO boats (code,name,class_name,owner_id,notes,revision,created_at)
       VALUES ($1,$2,$3,$4,'',1,now()) ON CONFLICT (code) DO NOTHING`,
      [b.code, b.name, b.class_name, b.owner],
    );
    let ord = 0;
    for (const key of ['I', 'J', 'P', 'E', 'LL', 'LP'] as const) {
      ord += 1;
      await db.query(
        `INSERT INTO measurements (id,boat_code,dimension,value_mm,measured_on,source,submission_id,recorded_at,ord)
         VALUES ($1,$2,$3,$4,$5,'sailmaker',null,$6,$7)`,
        [opaqueId('m'), b.code, key, b.dims[key], '2026-01-15', '2026-01-15T09:00:00Z', ord],
      );
    }
  }
  for (const rm of seedRemeasurements) {
    await db.query(
      `INSERT INTO measurements (id,boat_code,dimension,value_mm,measured_on,source,submission_id,recorded_at,ord)
       VALUES ($1,$2,$3,$4,$5,'sailmaker',null,$6,
         (SELECT COALESCE(MAX(ord),0)+1 FROM measurements WHERE boat_code=$2 AND dimension=$3))`,
      [opaqueId('m'), rm.boat, rm.dimension, rm.value, rm.on, `${rm.on}T10:00:00Z`],
    );
  }

  const dimsOf = (boat: string, dim: string): number => {
    const b = seedBoats.find((x) => x.code === boat)!;
    return (b.dims as unknown as Record<string, number>)[dim]!;
  };

  for (const s of buildSeedSubmissions(dimsOf)) {
    await db.query(
      `INSERT INTO submissions (id,boat_code,dimension,value_mm,as_submitted,measured_on,note,status,submitted_by,submitted_at,decided_at,decided_by,reason)
       VALUES ($1,$2,$3,$4,$5,$6,'',$7,(SELECT id FROM accounts WHERE id=$8),$9,$10,$11,$12)`,
      [s.id, s.boat, s.dimension, s.value, `${s.value} mm`, s.on, s.status, s.owner, s.submittedAt,
        s.status === 'pending' ? null : s.decidedAt,
        s.status === 'pending' ? null : 'morwenna@tabling.example',
        s.reason],
    );
  }
  // Accepted, non-reversed submissions also appear as measurements with source submission.
  for (const s of buildSeedSubmissions(dimsOf)) {
    if (s.status !== 'accepted') continue;
    await db.query(
      `INSERT INTO measurements (id,boat_code,dimension,value_mm,measured_on,source,submission_id,recorded_at,ord)
       VALUES ($1,$2,$3,$4,$5,'submission',$6,$7,
         (SELECT COALESCE(MAX(ord),0)+1 FROM measurements WHERE boat_code=$2 AND dimension=$3))`,
      [opaqueId('m'), s.boat, s.dimension, s.value, s.on, s.id, s.decidedAt],
    );
  }
  void seedPendingIds;

  for (const r of seedRolls) {
    await db.query(
      `INSERT INTO stock (code,kind,cloth_code,lot,width_mm,usable_width_mm,remaining_mm,on_hand_mm2,shelf_location,note,revision,created_at)
       VALUES ($1,'roll',$2,$3,$4,$5,$6,$7,$8,'',1,now()) ON CONFLICT (code) DO NOTHING`,
      [r.code, r.cloth, r.lot, r.width, r.usable, r.remaining, r.onHand, r.shelf],
    );
  }
  for (const o of seedOffcuts) {
    await db.query(
      `INSERT INTO stock (code,kind,cloth_code,lot,width_mm,usable_width_mm,remaining_mm,on_hand_mm2,shelf_location,note,revision,created_at)
       VALUES ($1,'offcut',$2,$3,$4,$5,$6,$7,'Offcut bin','',1,now()) ON CONFLICT (code) DO NOTHING`,
      [o.code, o.cloth, o.lot, o.width, o.usable, o.length, o.width * o.length],
    );
  }

  // Ledger: 600 pairs, 1200 lines, ids in posting order.
  let lineId = 0;
  let pair = 0;
  const pairIds: string[] = [];
  for (let p = 1; p <= 600; p++) pairIds.push(opaqueId('pair'));
  const postPairAt = async (postedAt: string, stockCode: string, stockAmount: number, counterAccount: string, reason: string, drawing: string, pid: string) => {
    pair += 1;
    lineId += 1;
    await db.query(
      `INSERT INTO ledger_line (line_id,pair_id,posted_at,account,amount_mm2,stock_code,drawing_code,actor_email,reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'morwenna@tabling.example',$8)`,
      [lineId, pid, postedAt, stockCode, stockAmount, stockCode, drawing, reason],
    );
    lineId += 1;
    await db.query(
      `INSERT INTO ledger_line (line_id,pair_id,posted_at,account,amount_mm2,stock_code,drawing_code,actor_email,reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'morwenna@tabling.example',$8)`,
      [lineId, pid, postedAt, counterAccount, -stockAmount, stockCode, drawing, reason],
    );
  };
  for (let p = 1; p <= 16; p++) {
    const roll = seedRolls[p - 1]!;
    await postPairAt(seedPairPostedAt(p), roll.code, roll.width * 50000, 'supplier-receipt', 'Received, full roll', '', pairIds[p - 1]!);
  }
  for (let p = 17; p <= 24; p++) {
    const offcut = seedOffcuts[p - 17]!;
    await postPairAt(seedPairPostedAt(p), offcut.code, offcut.width * offcut.length, 'opening-stock', 'Opening count', '', pairIds[p - 1]!);
  }
  for (let j = 0; j <= 575; j++) {
    const roll = seedRolls[j % 16]!;
    const cut = (50000 - roll.remaining) / 36;
    await postPairAt(seedPairPostedAt(25 + j), roll.code, -(roll.width * cut), 'imported-history', 'Imported from spreadsheet', '', pairIds[25 + j - 1]!);
  }

  // Drawings.
  const drawings = buildSeedDrawings();
  for (const d of drawings) {
    const boat = seedBoats.find((b) => b.code === d.boat)!;
    const owner = seedAccounts.find((a) => a.id === boat.owner)!;
    const usable = clothUsable.get(d.cloth)!;
    const isDrawn = d.ruleset !== null;
    const luff = d.sail === 'mainsail' ? boat.dims.P : boat.dims.LL;
    const foot = d.sail === 'mainsail' ? boat.dims.E : boat.dims.LP;
    const pinned = seedRules(d);
    const area = isDrawn ? sailArea(d.sail, { P: boat.dims.P, E: boat.dims.E, LL: boat.dims.LL, LP: boat.dims.LP }, pinned.roach) : null;
    const panels = isDrawn ? crosscutPanels(luff, foot, usable, pinned.seamOverlap) : [];
    const dims = d.sail === 'mainsail'
      ? [{ key: 'P', value_mm: boat.dims.P }, { key: 'E', value_mm: boat.dims.E }]
      : [{ key: 'LL', value_mm: boat.dims.LL }, { key: 'LP', value_mm: boat.dims.LP }];
    await db.query(
      `INSERT INTO drawings (code,boat_code,sail,cloth_code,status,ruleset_version,assigned_to,luff_mm,foot_mm,area_mm2,
        draw_boat_name,draw_owner_name,draw_dims,panels,predecessor,successor,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,(SELECT id FROM accounts WHERE id=$7),$8,$9,$10,$11,$12,$13,$14,null,null,now())
       ON CONFLICT (code) DO NOTHING`,
      [d.code, d.boat, d.sail, d.cloth, d.status, d.ruleset, d.assignedTo, isDrawn ? luff : null, isDrawn ? foot : null,
        area, isDrawn ? boat.name : null, isDrawn ? owner.display_name : null, JSON.stringify(isDrawn ? dims : null), JSON.stringify(panels)],
    );
  }

  // Issued, Pending store and Cut drawings carry one Cut claim, laid at automatic positions.
  for (const d of drawings) {
    if (d.ruleset === null || d.status === 'drawn' || d.status === 'measuring' || d.status === 'remeasure') continue;
    const boat = seedBoats.find((b) => b.code === d.boat)!;
    const luff = d.sail === 'mainsail' ? boat.dims.P : boat.dims.LL;
    const foot = d.sail === 'mainsail' ? boat.dims.E : boat.dims.LP;
    const usable = clothUsable.get(d.cloth)!;
    const pinnedClaim = seedRules(d);
    const panels = crosscutPanels(luff, foot, usable, pinnedClaim.seamOverlap);
    const stockCode = d.cloth === 'C-18' ? 'R-14' : d.sail === 'mainsail' ? 'R-03' : 'R-02';
    const { firstFitSequence } = await import('../domain/nesting.ts');
    const lays = firstFitSequence(panels, 50000, usable);
    const used = Math.max(...lays.map((l: { x: number; panel_number: number }) => l.x + panels.find((p) => p.number === l.panel_number)!.length_mm), 0);
    const claimId = opaqueId('claim');
    await db.query(
      `INSERT INTO claims (id,stock_code,drawing_code,holder_id,length_mm,status,taken_at,expires_at,cut_at)
       VALUES ($1,$2,$3,(SELECT id FROM accounts WHERE email_norm='morwenna@tabling.example'),$4,'cut','2026-05-01T08:00:00Z','2026-05-01T08:20:00Z','2026-05-01T08:10:00Z')`,
      [claimId, stockCode, d.code, used],
    );
    for (const lay of lays) {
      await db.query(
        `INSERT INTO lays (claim_id,panel_number,x_mm,y_mm,rotation) VALUES ($1,$2,$3,$4,$5)`,
        [claimId, lay.panel_number, lay.x, lay.y, lay.rotation],
      );
    }
    if (d.status === 'issued' || d.status === 'pending_store') {
      // The cut sheet is rendered, stored and confirmed by the caller of seedLoft.
      const view = await seedDrawingView(db, d, panels, areaOf(d));
      const svg = deps.renderCutSheet(view);
      const bytes = Buffer.from(svg, 'utf8');
      const sha = (await import('./util.ts')).sha256Hex(bytes);
      const key = `cut-sheets/${d.code}/${sha}.svg`;
      const confirmed = await deps.storePutConfirmed(key, bytes);
      const status = confirmed ? 'issued' : 'pending_store';
      await db.query(
        `UPDATE drawings SET cut_sheet_sha256=$1, cut_sheet_size=$2, cut_sheet_key=$3, status=$4 WHERE code=$5`,
        [sha, bytes.length, key, status, d.code],
      );
    }
  }

  for (const g of buildSeedGrants()) {
    await db.query(
      `INSERT INTO grants (id,drawing_code,owner_id,status,granted_at,ends_at,withdrawn_at)
       VALUES ($1,$2,$3,$4,$5,null,$6) ON CONFLICT (id) DO NOTHING`,
      [g.id, g.drawing, g.owner, g.withdrawnAt ? 'withdrawn' : 'granted', g.grantedAt, g.withdrawnAt],
    );
  }

  await db.query(`INSERT INTO sequences (name,next_value) VALUES ('boat',13) ON CONFLICT (name) DO NOTHING`);
  await db.query(`INSERT INTO sequences (name,next_value) VALUES ('drawing',241) ON CONFLICT (name) DO NOTHING`);
  await db.query(`INSERT INTO sequences (name,next_value) VALUES ('roll',17) ON CONFLICT (name) DO NOTHING`);
  await db.query(`INSERT INTO sequences (name,next_value) VALUES ('offcut',9) ON CONFLICT (name) DO NOTHING`);
  await db.query(`INSERT INTO sequences (name,next_value) VALUES ('submission',123) ON CONFLICT (name) DO NOTHING`);
  await db.query(`INSERT INTO sequences (name,next_value) VALUES ('grant',61) ON CONFLICT (name) DO NOTHING`);
  await db.query(`INSERT INTO sequences (name,next_value) VALUES ('account',10) ON CONFLICT (name) DO NOTHING`);
  await db.query(`INSERT INTO sequences (name,next_value) VALUES ('ledger',1201) ON CONFLICT (name) DO NOTHING`);
  await db.query(`INSERT INTO seed_lock (id,done) VALUES (1,true) ON CONFLICT (id) DO NOTHING`);
}

function areaOf(d: SeedDrawing): number {
  const boat = seedBoats.find((b) => b.code === d.boat)!;
  return sailArea(d.sail, { P: boat.dims.P, E: boat.dims.E, LL: boat.dims.LL, LP: boat.dims.LP }, DRAW_BASE.roach);
}

async function seedDrawingView(db: DbClient, d: SeedDrawing, panels: PanelShape[], area: number): Promise<SeedDrawingView> {
  const viewRules = seedRules(d);
  const boat = seedBoats.find((b) => b.code === d.boat)!;
  const owner = seedAccounts.find((a) => a.id === boat.owner)!;
  const cloth = seedCloths.find((c) => c.code === d.cloth)!;
  const dims = d.sail === 'mainsail'
    ? [{ key: 'P', value_mm: boat.dims.P }, { key: 'E', value_mm: boat.dims.E }]
    : [{ key: 'LL', value_mm: boat.dims.LL }, { key: 'LP', value_mm: boat.dims.LP }];
  const nests = await nestViews(db, d, panels);
  return {
    code: d.code, boatName: boat.name, sail: d.sail, ownerName: owner.display_name,
    clothCode: d.cloth, clothName: clothName(cloth.weightOz), usableWidth: cloth.usable, catalogueWidth: cloth.width,
    rulesetVersion: d.ruleset!, dims, areaMm2: area, panels,
    seamOverlap: viewRules.seamOverlap, tolerance: viewRules.tolerance, roach: viewRules.roach,
    predecessor: null, nests,
  };
}

async function nestViews(db: DbClient, d: SeedDrawing, panels: PanelShape[]): Promise<SeedDrawingView['nests']> {
  const rows = await db.query<{ stock_code: string; length_mm: number; lot: string; width_mm: number }>(
    `SELECT c.stock_code, c.length_mm, s.width_mm, s.usable_width_mm, s.lot FROM claims c JOIN stock s ON s.code=c.stock_code WHERE c.drawing_code=$1 AND c.status='cut'`,
    [d.code],
  );
  const out: SeedDrawingView['nests'] = [];
  for (const row of rows) {
    const lays = await db.query<{ panel_number: number; x_mm: number; y_mm: number; rotation: number }>(
      `SELECT panel_number,x_mm,y_mm,rotation FROM lays WHERE claim_id=(SELECT id FROM claims WHERE drawing_code=$1 AND status='cut' LIMIT 1)`,
      [d.code],
    );
    const outlines = lays.map((l) => outlineAt(panels, l.panel_number, l.x_mm, l.y_mm, l.rotation));
    out.push({ stock: row.stock_code, used: row.length_mm, width: row.width_mm, lot: row.lot, panelOutlines: outlines });
  }
  return out;
}

function outlineAt(panels: PanelShape[], number: number, x: number, y: number, rotation: number): [number, number][] {
  const panel = panels.find((p) => p.number === number)!;
  if (rotation === 0) return panel.outline.map((p) => [p[0]! + x, p[1]! + y] as [number, number]);
  return panel.outline.map((p) => [panel.length_mm - p[0]! + x, panel.width_mm - p[1]! + y] as [number, number]);
}

export { foretriangleArea };
