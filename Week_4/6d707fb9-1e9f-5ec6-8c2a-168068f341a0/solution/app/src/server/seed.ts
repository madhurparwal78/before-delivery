import { addDays, localDate, LISBON, nextClockChange, wallToInstant } from "../shared/time";
import type { Line } from "../shared/api";
import { townZone } from "../shared/catalog";
import { now, SCHEMA, transaction, type Queryable } from "./db";
import { SEED_ROWS_2026_2, SEED_ROWS_2027_1, type LibraryRow } from "./footprint";
import { footprintInputs, insertResult, linesOf, legsOf, loadStyle, newId, newToken } from "./domain";
import { hashPassword } from "./routes/desk";
import { bodyKey, scoreBody } from "./routes/results";

const SEED_PASSWORD = "desk-pass-2027";
const SCHEMA_LOCK = 7_204_411;

interface SeedTier {
  factory: string;
  town: string;
  country: string;
}

interface SeedStyle {
  name: string;
  code: string;
  label: string;
  season: string;
  gtin: string;
  garment: string;
  grams: string;
  material: string;
  tier1: SeedTier | null;
  tier2: SeedTier | null;
  tier3: SeedTier | null;
  leg: { mode: string; km: string } | null;
  fibre: string;
}

const STYLES: SeedStyle[] = [
  {
    name: "Harbour Tee", code: "HT-01", label: "Maré Alta", season: "AW27", gtin: "4006381333931", garment: "tshirt",
    grams: "250", material: "organic-cotton", fibre: "Organic cotton",
    tier1: { factory: "Yıldız İplik", town: "Izmir", country: "TR" },
    tier2: { factory: "Ege Dokuma", town: "Izmir", country: "TR" },
    tier3: { factory: "Surat Fibre Co-op", town: "Surat", country: "IN" },
    leg: { mode: "road", km: "3200" },
  },
  {
    name: "Quay Shirt", code: "QS-01", label: "Maré Alta", season: "AW27", gtin: "5600000000014", garment: "shirt",
    grams: "300", material: "linen", fibre: "Linen",
    tier1: { factory: "Coton Bio Éthique", town: "Ho Chi Minh City", country: "VN" },
    tier2: { factory: "Saigon Looms", town: "Ho Chi Minh City", country: "VN" },
    tier3: { factory: "Mekong Flax", town: "Can Tho", country: "VN" },
    leg: { mode: "sea", km: "10000" },
  },
  {
    name: "Estuary Coat", code: "EC-01", label: "Atelier Noroeste", season: "AW27", gtin: "5600000000021", garment: "coat",
    grams: "1200", material: "wool", fibre: "Wool",
    tier1: { factory: "Fiação do Ave", town: "Porto", country: "PT" }, tier2: null, tier3: null,
    leg: { mode: "road", km: "450" },
  },
  {
    name: "Delta Jeans", code: "DJ-01", label: "Linho & Sal", season: "SS27", gtin: "5600000000038", garment: "jeans",
    grams: "800", material: "cotton", fibre: "Cotton",
    tier1: { factory: "Nile Delta Weaving", town: "Cairo", country: "EG" }, tier2: null, tier3: null,
    leg: null,
  },
  {
    name: "Ribeira Polo", code: "RP-01", label: "Linho & Sal", season: "SS27", gtin: "5600000000045", garment: "tshirt",
    grams: "220", material: "cotton", fibre: "Cotton",
    tier1: null, tier2: null, tier3: null, leg: null,
  },
];

async function addStyle(tx: Queryable, assessorId: string, labelId: string, style: SeedStyle, at: Date): Promise<string> {
  const id = newId();
  await tx.query(
    `INSERT INTO styles (id, assessor_id, label_id, style_code, name, season, gtin, garment, washes, state, changed_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 30, 'draft', $9)`,
    [id, assessorId, labelId, style.code, style.name, style.season, style.gtin, style.garment, at],
  );
  await tx.query(
    `INSERT INTO lines (id, style_id, position, material_id, mass_grams, fibres, tier1, tier2, tier3) VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8)`,
    [newId(), id, style.material, style.grams, JSON.stringify([{ name: style.fibre, sharePercent: "100.0" }]), JSON.stringify(style.tier1), JSON.stringify(style.tier2), JSON.stringify(style.tier3)],
  );
  if (style.leg) await tx.query(`INSERT INTO legs (id, style_id, position, mode, km) VALUES ($1, $2, 1, $3, $4)`, [newId(), id, style.leg.mode, style.leg.km]);
  return id;
}

async function seedResult(tx: Queryable, assessorId: string, styleId: string, edition: string, validFrom: string, rows: LibraryRow[], at: string): Promise<string> {
  const style = await loadStyle(tx, assessorId, styleId);
  const lines: Line[] = await linesOf(tx, styleId);
  return insertResult(tx, style, edition, validFrom, rows, footprintInputs(lines, await legsOf(tx, styleId), style.washes), new Date(at));
}

async function seedRequest(
  tx: Queryable,
  assessorId: string,
  styleId: string,
  lineId: string,
  supplier: { name: string; contact: string; email: string; town: string; language: string },
  fields: { questions: string[]; due: string; sentAt: string; endsAt: string; ended: boolean; answer: object | null; answeredAt: string | null },
): Promise<void> {
  const id = newId();
  const token = newToken();
  await tx.query(
    `INSERT INTO requests (id, assessor_id, style_id, line_id, supplier_name, contact_name, contact_email, town, language, questions, due_date, token, sent_at, ends_at, ended, answered_at, answer)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
    [id, assessorId, styleId, lineId, supplier.name, supplier.contact, supplier.email, supplier.town, supplier.language, JSON.stringify(fields.questions), fields.due, token, new Date(fields.sentAt), new Date(fields.endsAt), fields.ended, fields.answeredAt ? new Date(fields.answeredAt) : null, fields.answer ? JSON.stringify(fields.answer) : null],
  );
  await tx.query(`INSERT INTO request_pages (token, request_id) VALUES ($1, $2)`, [token, id]);
}

/** Exactly the published seed data and nothing else. */
async function seed(tx: Queryable): Promise<void> {
  const passwordHash = await hashPassword(SEED_PASSWORD);
  const at = now();
  const marta = newId();
  const iris = newId();
  await tx.query(`INSERT INTO assessors (id, name, email, password_hash) VALUES ($1, 'Marta Quintela', 'marta@fio-contado.example', $3), ($2, 'Iris Vandeputte', 'iris@fio-contado.example', $3)`, [marta, iris, passwordHash]);

  const labels = new Map<string, string>();
  for (const [name, contact, email] of [
    ["Maré Alta", "Inês Barros", "ines@mare-alta.example"],
    ["Linho & Sal", "Tomás Leite", "tomas@linho-sal.example"],
    ["Atelier Noroeste", "Clara Pinto", "clara@atelier-noroeste.example"],
  ] as const) {
    const id = newId();
    labels.set(name, id);
    await tx.query(`INSERT INTO labels (id, assessor_id, name, contact_name, contact_email, state) VALUES ($1, $2, $3, $4, $5, 'open')`, [id, marta, name, contact, email]);
  }

  const suppliers = [
    { name: "Yıldız İplik", label: "Maré Alta", town: "izmir", language: "tr", contact: "Ayşe Demir", email: "ayse@yildiz-iplik.example" },
    { name: "Coton Bio Éthique", label: "Maré Alta", town: "hoChiMinhCity", language: "fr", contact: "Camille Nguyen", email: "camille@coton-bio.example" },
    { name: "Fiação do Ave", label: "Atelier Noroeste", town: "porto", language: "en", contact: "Rui Matos", email: "rui@fiacao-ave.example" },
    { name: "Nile Delta Weaving", label: "Linho & Sal", town: "cairo", language: "ar", contact: "Salma Hassan", email: "salma@nile-delta.example" },
  ];
  for (const supplier of suppliers) {
    await tx.query(
      `INSERT INTO suppliers (id, label_id, name, town, language, contact_name, contact_email) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [newId(), labels.get(supplier.label), supplier.name, supplier.town, supplier.language, supplier.contact, supplier.email],
    );
  }

  const ids = new Map<string, string>();
  for (const style of STYLES) ids.set(style.name, await addStyle(tx, marta, labels.get(style.label) as string, style, at));
  const harbour = ids.get("Harbour Tee") as string;
  const quay = ids.get("Quay Shirt") as string;
  const coat = ids.get("Estuary Coat") as string;
  await tx.query(`UPDATE styles SET repair_service = false, range_size = 100000, notes = 'Check dye house meter in spring.' WHERE id = $1`, [harbour]);
  await tx.query(`UPDATE styles SET state = 'archived' WHERE id = $1`, [ids.get("Ribeira Polo")]);

  await tx.query(`UPDATE lines SET fibre_origin = 'VN' WHERE style_id = $1`, [quay]);
  await seedResult(tx, marta, harbour, "2026.2", "2026-01-01", SEED_ROWS_2026_2, "2026-03-10T09:00:00Z");
  const harbourLatest = await seedResult(tx, marta, harbour, "2027.1", "2026-07-01", SEED_ROWS_2027_1, "2026-09-15T09:00:00Z");
  await seedResult(tx, marta, quay, "2026.2", "2026-01-01", SEED_ROWS_2026_2, "2026-03-12T09:00:00Z");
  await seedResult(tx, marta, coat, "2027.1", "2026-07-01", SEED_ROWS_2027_1, "2026-09-16T09:00:00Z");

  const [harbourLine] = await linesOf(tx, harbour);
  const [quayLine] = await linesOf(tx, quay);
  await seedRequest(tx, marta, harbour, (harbourLine as Line).id, { name: "Yıldız İplik", contact: "Ayşe Demir", email: "ayse@yildiz-iplik.example", town: "izmir", language: "tr" }, {
    questions: ["energy", "water", "fibreOrigin"], due: "2026-09-01", sentAt: "2026-08-20T09:00:00Z", endsAt: "2026-09-01T20:59:59Z", ended: true, answer: null, answeredAt: null,
  });
  await seedRequest(tx, marta, quay, (quayLine as Line).id, { name: "Coton Bio Éthique", contact: "Camille Nguyen", email: "camille@coton-bio.example", town: "hoChiMinhCity", language: "fr" }, {
    questions: ["fibreOrigin"], due: "2026-03-10", sentAt: "2026-03-01T09:00:00Z", endsAt: "2026-03-10T16:59:59Z", ended: false,
    answer: { energyValue: null, energyUnit: null, energyMjPerKg: null, waterLitresPerKg: null, fibreOrigin: "VN", evidenceIds: [], answeredAt: "2026-03-05T10:00:00Z", state: "answered" },
    answeredAt: "2026-03-05T10:00:00Z",
  });

  const harbourStyle = await loadStyle(tx, marta, harbour);
  const scoreId = newId();
  await tx.query(
    `INSERT INTO scores (id, style_id, body_key, score, per100g, run_id, worst_case_facts) VALUES ($1, $2, $3, 1240, 412, 'run-seed', '[]')`,
    [scoreId, harbour, bodyKey(scoreBody(harbourStyle, harbourLine ? [harbourLine] : []))],
  );
  await tx.query(`UPDATE styles SET score_id = $2, score_state = 'current', state = 'published' WHERE id = $1`, [harbour, scoreId]);

  const measures = (await tx.query(`SELECT measures FROM results WHERE id = $1`, [harbourLatest])).rows[0].measures as { measure: string; totalShown: string }[];
  await tx.query(`INSERT INTO passports (gtin, assessor_id, style_id, state) VALUES ('4006381333931', $1, $2, 'published')`, [marta, harbour]);
  await tx.query(`INSERT INTO passport_editions (gtin, edition, published_at, snapshot) VALUES ('4006381333931', 1, $1, $2)`, [
    new Date("2026-09-20T10:00:00Z"),
    JSON.stringify({
      styleName: "Harbour Tee", labelName: "Maré Alta", garment: "tshirt", factorEdition: "2027.1",
      dataQualityPercent: 0, dataQualityGrade: "C", score: 1240, per100g: 412,
      measures: measures.map(({ measure, totalShown }) => ({ measure, totalShown })),
    }),
  ]);

  await tx.query(
    `INSERT INTO dossiers (id, assessor_id, style_id, result_id, edition, state, made_at, signed_off_by, signed_off_at) VALUES ($1, $2, $3, $4, '2027.1', 'signedOff', $5, 'Inês Barros', $6)`,
    [newId(), marta, harbour, harbourLatest, new Date("2026-09-21T09:00:00Z"), new Date("2026-09-22T15:00:00Z")],
  );

  const change = nextClockChange(localDate(at, LISBON));
  for (const date of [addDays(change, -2), addDays(change, 1)]) {
    await tx.query(
      `INSERT INTO visits (id, assessor_id, label_id, factory_name, town, local_date, local_time, at) VALUES ($1, $2, $3, 'Yıldız İplik', 'izmir', $4, '07:20', $5)`,
      [newId(), marta, labels.get("Maré Alta"), date, wallToInstant(date, "07:20", townZone("izmir"))],
    );
  }

  const kade = newId();
  await tx.query(`INSERT INTO labels (id, assessor_id, name, contact_name, contact_email, state) VALUES ($1, $2, 'Kade Studio', 'Jef Maes', 'jef@kade-studio.example', 'open')`, [kade, iris]);
  await tx.query(
    `INSERT INTO styles (id, assessor_id, label_id, name, season, gtin, garment, washes, state, changed_at) VALUES ($1, $2, $3, 'Kade Overshirt', 'AW27', '5600000000069', 'shirt', 30, 'draft', $4)`,
    [newId(), iris, kade, at],
  );
}

/** Schema and seed, idempotent on every serve; several copies starting together are safe. */
export async function prepareDatabase(): Promise<void> {
  await transaction(async (tx) => {
    await tx.query(`SELECT pg_advisory_xact_lock($1)`, [SCHEMA_LOCK]);
    await tx.query(SCHEMA);
    const { rows } = await tx.query(`SELECT 1 FROM assessors WHERE email = 'marta@fio-contado.example'`);
    if (!rows[0]) await seed(tx);
  });
}
