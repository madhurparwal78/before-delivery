/**
 * Seeds an empty database with exactly the published starting records, with
 * every date set from the Turin date the copy starts.
 */
import { createHash } from 'node:crypto';
import type { App } from '../app.ts';
import { hashPassword } from './pool.ts';
import { withSeedLock } from './schema.ts';
import {
  BENCH_JOBS,
  CATALOGUE,
  DESKS,
  ESTIMATES,
  HOLDS,
  PIECES,
  PINS,
  SEEDED_LABEL_BYTES,
  STARTING_RATE,
  STARTING_MATERIALS,
} from './seedData.ts';
import { parseDec } from '../domain/decimal.ts';
import { seededPlacements } from '../domain/layout.ts';
import {
  computeEstimate,
  priceOf,
  TOWN_CURRENCY,
  TOWN_TAX_PERCENT,
  toMinor,
} from '../domain/money.ts';
import { generatePhotograph } from '../domain/png.ts';
import {
  addDays,
  dateText,
  isoWeekday,
  localDate,
  mondayOf,
  nextZoneTransition,
  parseDate,
  TOWN_ZONE,
  wallToInstant,
  BUSINESS_ZONE,
  type Town,
} from '../domain/time.ts';
import { storageKeys } from '../services/storage.ts';
import type { Row } from '../present.ts';
import { renderAndStore } from '../features/dossier.ts';

const SEED_KEY = 'seeded';

/** Puts the published materials and the starting labour rate on a desk. */
export async function giveDeskItsStartingRows(app: App, deskId: string): Promise<void> {
  for (const [index, material] of STARTING_MATERIALS.entries()) {
    await app.db.query(
      `INSERT INTO materials (desk_id, code, name, family, unit, prices, position)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (desk_id, code) DO NOTHING`,
      [deskId, material.code, material.name, material.family, material.unit, JSON.stringify(material.prices), index],
    );
  }
  await app.db.query(
    `INSERT INTO rates (desk_id, takes_effect_on, eur, gbp, usd, jpy, aed)
     VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (desk_id, takes_effect_on) DO NOTHING`,
    [
      deskId,
      STARTING_RATE.takesEffectOn,
      STARTING_RATE.eur,
      STARTING_RATE.gbp,
      STARTING_RATE.usd,
      STARTING_RATE.jpy,
      STARTING_RATE.aed,
    ],
  );
}

async function seedRecords(app: App): Promise<void> {
  const now = app.now();
  const todayText = localDate(BUSINESS_ZONE, now);
  const today = parseDate(todayText)!;

  const deskIds = new Map<string, string>();
  for (const desk of DESKS) {
    const row = await app.db.one<Row>(
      `INSERT INTO desks (name, email, password_hash) VALUES ($1,$2,$3) RETURNING id`,
      [desk.name, desk.email, hashPassword(desk.password)],
    );
    const deskId = String(row!.id);
    deskIds.set(desk.email, deskId);
    await giveDeskItsStartingRows(app, deskId);
  }

  const pieceIds = new Map<string, string>();
  const clientIds = new Map<string, string>();

  for (const seed of PIECES) {
    const deskId = deskIds.get(seed.deskEmail)!;
    let clientId = clientIds.get(`${deskId}|${seed.clientName}`);
    if (!clientId) {
      const client = await app.db.one<Row>(
        `INSERT INTO clients (desk_id, name, town, language, email) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [deskId, seed.clientName, seed.clientTown, seed.clientLanguage, seed.clientEmail],
      );
      clientId = String(client!.id);
      clientIds.set(`${deskId}|${seed.clientName}`, clientId);
    }

    const piece = await app.db.one<Row>(
      `INSERT INTO pieces (desk_id, client_id, title, maker, year, stamp_number,
         width_cm, depth_cm, height_cm, weight_kg, due_date, state, pin_high, photo_high)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
      [
        deskId,
        clientId,
        seed.title,
        seed.maker,
        seed.year,
        seed.stampNumber,
        seed.widthCm,
        seed.depthCm,
        seed.heightCm,
        seed.weightKg,
        dateText(addDays(today, seed.dueInDays)),
        seed.state,
        PINS.length,
        2,
      ],
    );
    const pieceId = String(piece!.id);
    pieceIds.set(seed.title, pieceId);

    for (const pin of PINS) {
      await app.db.query(
        `INSERT INTO pins (piece_id, number, x, y, kind, note, signed) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [pieceId, pin.number, pin.x, pin.y, pin.kind, pin.note, pin.signed],
      );
    }

    for (const [index, side] of (['before', 'after'] as const).entries()) {
      const bytes = generatePhotograph(seed.title, side);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      await app.db.query(
        `INSERT INTO photographs (piece_id, number, side, sha256, bytes, state)
         VALUES ($1,$2,$3,$4,$5,'waiting')`,
        [pieceId, index + 1, side, sha256, bytes.length],
      );
    }

    await app.db.query(
      `INSERT INTO layouts (piece_id, version, placements) VALUES ($1, 1, $2)`,
      [pieceId, JSON.stringify(seededPlacements())],
    );
  }

  // Holds, with their end dates taken from the Turin date the copy starts.
  for (const hold of HOLDS) {
    const pieceId = pieceIds.get(hold.pieceTitle)!;
    const endsOn = addDays(today, hold.endsOn === 'tomorrow' ? 1 : -1);
    await app.db.query(
      `INSERT INTO holds (piece_id, code, lot, quantity, hold_id, state, ends_on)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        pieceId,
        hold.code,
        hold.lot,
        hold.quantity,
        hold.holdId,
        hold.endsOn === 'tomorrow' ? 'held' : 'ended',
        dateText(endsOn),
      ],
    );
  }

  // Estimates, each worked out by the same arithmetic the API uses.
  const yesterday = addDays(today, -1);
  for (const seed of ESTIMATES) {
    const pieceId = pieceIds.get(seed.pieceTitle)!;
    const piece = await app.db.one<Row>(
      `SELECT p.desk_id, c.town FROM pieces p JOIN clients c ON c.id = p.client_id WHERE p.id = $1`,
      [pieceId],
    );
    const town = String(piece!.town) as Town;
    const currency = TOWN_CURRENCY[town];
    const taxPercent = TOWN_TAX_PERCENT[town];
    const material = CATALOGUE.find((m) => m.code === seed.materialCode)!;
    const rate = parseDec(STARTING_RATE[currency.toLowerCase() as 'eur'])!;
    const amounts = computeEstimate({
      currency,
      taxPercent,
      labourHours: parseDec(seed.labourHours)!,
      labourRate: rate,
      material: {
        pricePerUnit: priceOf(material.prices, currency),
        unit: 'sqFt',
        lotAverageSqFt: parseDec(seed.lotAverageSqFt)!,
      },
      patternAreaSqFt: parseDec(seed.patternAreaSqFt)!,
    });
    const signedAt = seed.signedOffBy
      ? new Date(wallToInstant(BUSINESS_ZONE, { ...yesterday, hour: 10, minute: 0, second: 0 })!)
      : null;
    await app.db.query(
      `INSERT INTO estimates (desk_id, piece_id, version, state, currency, material_code, lot,
         pattern_area, hides, labour_hours, labour_rate_minor, material_minor, labour_minor,
         subtotal_minor, tax_percent, tax_minor, total_minor, signed_by, signed_at)
       VALUES ($1,$2,1,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        piece!.desk_id,
        pieceId,
        seed.signedOffBy ? 'signedOff' : 'open',
        currency,
        seed.materialCode,
        seed.lot,
        seed.patternAreaSqFt,
        amounts.hides,
        seed.labourHours,
        String(toMinor(currency, rate)),
        String(amounts.materialMinor),
        String(amounts.labourMinor),
        String(amounts.subtotalMinor),
        taxPercent,
        String(amounts.taxMinor),
        String(amounts.totalMinor),
        seed.signedOffBy ?? null,
        signedAt,
      ],
    );
  }

  // Bench jobs in the current Turin week.
  const monday = mondayOf(today);
  for (const job of BENCH_JOBS) {
    const pieceId = pieceIds.get(job.pieceTitle)!;
    const piece = await app.db.one<Row>(`SELECT desk_id FROM pieces WHERE id = $1`, [pieceId]);
    await app.db.query(
      `INSERT INTO bench_jobs (desk_id, piece_id, bench, day) VALUES ($1,$2,$3,$4)`,
      [piece!.desk_id, pieceId, job.bench, dateText(addDays(monday, job.weekday - 1))],
    );
  }

  // Two collections on Cantilever side chair, around the next New York change.
  const cantilever = pieceIds.get('Cantilever side chair')!;
  const cantileverDesk = await app.db.one<Row>(`SELECT desk_id FROM pieces WHERE id = $1`, [
    cantilever,
  ]);
  const nyZone = TOWN_ZONE['New York'];
  const changeMs = nextZoneTransition(nyZone, now);
  const changeDate = parseDate(localDate(nyZone, changeMs))!;
  const mondayBefore = addDays(mondayOf(changeDate), isoWeekday(changeDate) === 1 ? -7 : 0);
  const mondayAfter = addDays(mondayBefore, 7);
  const seededCollections = [
    { courierId: 'C-8001', day: mondayBefore },
    { courierId: 'C-8002', day: mondayAfter },
  ];
  for (const collection of seededCollections) {
    const collectAt = wallToInstant(nyZone, { ...collection.day, hour: 9, minute: 0, second: 0 })!;
    await app.db.query(
      `INSERT INTO collections (desk_id, piece_id, quote_id, courier_id, state, collect_at,
         local_date, local_time, town, repeat_key)
       VALUES ($1,$2,'Q-5001',$3,'waiting',$4,$5,'09:00','New York',$6)`,
      [
        cantileverDesk!.desk_id,
        cantilever,
        collection.courierId,
        new Date(collectAt),
        dateText(collection.day),
        `seed:${collection.courierId}`,
      ],
    );
  }

  // One signed dossier on Bentwood armchair.
  const bentwood = pieceIds.get('Bentwood armchair')!;
  const bentwoodRow = await app.db.one<Row>(`SELECT desk_id FROM pieces WHERE id = $1`, [bentwood]);
  const signedEstimate = await app.db.one<Row>(
    `SELECT id FROM estimates WHERE piece_id = $1 AND state = 'signedOff' ORDER BY version DESC LIMIT 1`,
    [bentwood],
  );
  const signedAt = new Date(
    wallToInstant(BUSINESS_ZONE, { ...yesterday, hour: 11, minute: 0, second: 0 })!,
  );
  const dossier = await app.db.one<Row>(
    `INSERT INTO dossiers (desk_id, piece_id, state, estimate_id, signed_by, signed_at)
     VALUES ($1,$2,'waiting',$3,$4,$5) RETURNING id`,
    [bentwoodRow!.desk_id, bentwood, signedEstimate!.id, DESKS[0]!.name, signedAt],
  );
  await app.db.query(
    `INSERT INTO dossier_history (dossier_id, at, who, what) VALUES ($1,$2,$3,'asked')`,
    [dossier!.id, signedAt, DESKS[0]!.name],
  );
}

/**
 * Finishes what needs a provider: photographs and labels in MinIO and the
 * seeded dossier's PDF. Safe to run again, so a copy that started with a
 * provider down catches up once it is back.
 */
export async function completeSeedArtifacts(app: App): Promise<void> {
  const waitingPhotographs = await app.db.query<Row>(
    `SELECT ph.id, ph.piece_id, ph.side, ph.sha256, p.desk_id, p.title
       FROM photographs ph JOIN pieces p ON p.id = ph.piece_id
      WHERE ph.state = 'waiting' ORDER BY ph.id`,
  );
  for (const row of waitingPhotographs) {
    const bytes = generatePhotograph(String(row.title), row.side as 'before' | 'after');
    try {
      await app.storage.put(
        storageKeys.photograph(String(row.desk_id), String(row.piece_id), String(row.sha256)),
        bytes,
        'image/png',
      );
    } catch {
      return;
    }
    await app.db.query(`UPDATE photographs SET state = 'stored' WHERE id = $1`, [row.id]);
  }

  const waitingCollections = await app.db.query<Row>(
    `SELECT id, desk_id, piece_id, courier_id FROM collections WHERE state = 'waiting' ORDER BY id`,
  );
  if (waitingCollections.length > 0) {
    const label = new TextEncoder().encode(SEEDED_LABEL_BYTES);
    const sha256 = createHash('sha256').update(label).digest('hex');
    for (const row of waitingCollections) {
      try {
        await app.storage.put(
          storageKeys.label(String(row.desk_id), String(row.piece_id), String(row.id)),
          label,
          'application/pdf',
        );
      } catch {
        return;
      }
      await app.db.query(
        `UPDATE collections SET state = 'booked', label_sha256 = $2 WHERE id = $1`,
        [row.id, sha256],
      );
    }
  }

  const waitingDossiers = await app.db.query<Row>(
    `SELECT id, desk_id, piece_id, estimate_id FROM dossiers
      WHERE state IN ('waiting', 'failed') AND signed_by IS NOT NULL ORDER BY id`,
  );
  for (const row of waitingDossiers) {
    await renderAndStore(
      app,
      String(row.id),
      String(row.desk_id),
      String(row.piece_id),
      row.estimate_id === null ? null : String(row.estimate_id),
    );
    const after = await app.db.one<Row>(
      `SELECT state, signed_by, signed_at FROM dossiers WHERE id = $1`,
      [row.id],
    );
    if (after?.state !== 'stored') continue;
    await app.db.query(`UPDATE dossiers SET state = 'signed' WHERE id = $1`, [row.id]);
    await app.db.query(
      `INSERT INTO dossier_history (dossier_id, at, who, what) VALUES ($1,$2,$3,'signed')`,
      [row.id, after.signed_at, after.signed_by],
    );
  }
}

/** Seeds once, even when several copies start together. */
export async function seedIfEmpty(app: App): Promise<void> {
  await withSeedLock(app.pool, async () => {
    const done = await app.db.one<Row>(`SELECT value FROM seed_state WHERE key = $1`, [SEED_KEY]);
    if (done) return;
    const existing = await app.db.one<Row>(`SELECT id FROM desks LIMIT 1`);
    if (existing) {
      await app.db.query(
        `INSERT INTO seed_state (key, value) VALUES ($1, 'kept') ON CONFLICT (key) DO NOTHING`,
        [SEED_KEY],
      );
      return;
    }
    await seedRecords(app);
    await app.db.query(
      `INSERT INTO seed_state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
      [SEED_KEY, app.todayText()],
    );
  });
}
