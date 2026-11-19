import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { hashPassword } from "../api/access.ts";
import { config } from "../config.ts";
import { one, query } from "./pool.ts";
import { seedPhotograph } from "./seedPictures.ts";
import { hidesNeeded, leatherAmount, workOutFigures } from "../domain/estimate.ts";
import { minorOfPrice, priceKey } from "../domain/money.ts";
import { type MaterialRow, STARTING_MATERIALS, STARTING_RATE } from "../domain/seedMaterials.ts";
import { addDays, addSeconds, mondayOf, nextClockChange, turinToday, wallInstant } from "../domain/time.ts";
import { TOWNS, TURIN_ZONE, type Language, type Town } from "../domain/towns.ts";

const DESKS = {
  agnese: { name: "Agnese Ferrero", email: "agnese@bottega-semenza.example", password: "tacks-and-hide-2027" },
  ruben: { name: "Ruben Marchetti", email: "ruben@bottega-semenza.example", password: "second-desk-2027" },
} as const;

interface SeedPiece {
  desk: keyof typeof DESKS;
  client: string;
  town: Town;
  language: Language;
  email: string;
  title: string;
  state: string;
  stamp: string;
  maker: string;
  year: string;
  size: readonly [string, string, string, string];
  dueDays: number;
}

const SEED_PIECES: readonly SeedPiece[] = [
  { desk: "agnese", client: "Giulia Ricci", town: "Turin", language: "it", email: "giulia@clients.example", title: "Lounge chair", state: "onTheBench", stamp: "48201768", maker: "Officina Bressan", year: "1957", size: ["66", "70", "78", "12.5"], dueDays: 21 },
  { desk: "agnese", client: "Harriet Osei", town: "London", language: "en", email: "harriet@clients.example", title: "Tubular armchair", state: "inSurvey", stamp: "60319522", maker: "Atelier Lindqvist", year: "1931", size: ["60", "64", "74", "9"], dueDays: 28 },
  { desk: "agnese", client: "Dana Whitlock", town: "New York", language: "en", email: "dana@clients.example", title: "Cantilever side chair", state: "inSurvey", stamp: "71540835", maker: "Harlan & Vance", year: "1949", size: ["48", "54", "80", "6.5"], dueDays: 35 },
  { desk: "agnese", client: "中村 葵", town: "Kyoto", language: "ja", email: "aoi@clients.example", title: "Folding deck chair", state: "inSurvey", stamp: "30972186", maker: "Kobo Tanizawa", year: "1962", size: ["58", "90", "84", "7"], dueDays: 42 },
  { desk: "agnese", client: "سارة المنصوري", town: "Dubai", language: "ar", email: "sara@clients.example", title: "Swivel desk chair", state: "inSurvey", stamp: "52166048", maker: "Studio Marchand", year: "1968", size: ["62", "62", "92", "14"], dueDays: 49 },
  { desk: "agnese", client: "Zoë Ørsted", town: "London", language: "en", email: "zoe@clients.example", title: "Bentwood armchair", state: "ready", stamp: "83407197", maker: "Werkstatt Adler", year: "1926", size: ["56", "58", "82", "5.5"], dueDays: 14 },
  { desk: "agnese", client: "MANIFATTURATESSILEEPELLETTERIADELLEVALLISUPERIORIDIBIELLAETORINO", town: "Turin", language: "it", email: "manifattura@clients.example", title: "Slat bench", state: "inSurvey", stamp: "26750414", maker: "Falegnameria Conti", year: "1953", size: ["120", "44", "42", "18"], dueDays: 56 },
  { desk: "ruben", client: "Ivo Kranjc", town: "London", language: "en", email: "ivo@clients.example", title: "Walnut stool", state: "inSurvey", stamp: "91283564", maker: "Dom Novak", year: "1960", size: ["36", "36", "44", "3"], dueDays: 30 },
];

const SEED_PINS = [
  { number: 1, x: 200, y: 300, kind: "tear", note: "**Tear** along the front seam", signed: true },
  { number: 2, x: 500, y: 600, kind: "stain", note: "*Stain* under the left arm", signed: true },
  { number: 3, x: 800, y: 300, kind: "looseJoint", note: "Check again before quoting", signed: false },
] as const;

const SEED_ESTIMATES: Record<string, { code: string; lot: string; averageSqFt: string; hours: string }> = {
  "Lounge chair": { code: "VM-2041", lot: "L-2041-A", averageSqFt: "48.25", hours: "12.50" },
  "Tubular armchair": { code: "VM-2044", lot: "L-2044-A", averageSqFt: "30.25", hours: "10.00" },
  "Cantilever side chair": { code: "VM-2047", lot: "L-2000-A", averageSqFt: "48.25", hours: "8.00" },
  "Folding deck chair": { code: "VM-2041", lot: "L-2041-B", averageSqFt: "52.75", hours: "6.00" },
  "Swivel desk chair": { code: "VM-2043", lot: "L-2000-A", averageSqFt: "48.25", hours: "5.00" },
  "Bentwood armchair": { code: "VM-2042", lot: "L-2000-A", averageSqFt: "48.25", hours: "9.00" },
};

const SEED_AREA = "14.54";

/** The label bytes the courier's stand-in answers; seeded collections keep them too. */
export const SEED_LABEL = Buffer.from("%PDF-1.4 portico label\n", "latin1");

/** Every new desk starts with the first twelve materials and the starting labour-rate row, and nothing else. */
export async function seedDeskStart(client: PoolClient, deskId: string): Promise<readonly MaterialRow[]> {
  for (const [position, material] of STARTING_MATERIALS.entries()) {
    await client.query(
      "INSERT INTO materials (desk_id, code, name, family, unit, prices, position) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [deskId, material.code, material.name, material.family, material.unit, JSON.stringify(material.prices), position],
    );
  }
  await client.query(
    "INSERT INTO rates (desk_id, takes_effect_on, eur, gbp, usd, jpy, aed) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [deskId, STARTING_RATE.takesEffectOn, STARTING_RATE.eur, STARTING_RATE.gbp, STARTING_RATE.usd, STARTING_RATE.jpy, STARTING_RATE.aed],
  );
  return STARTING_MATERIALS;
}

function materialOf(code: string): MaterialRow {
  return STARTING_MATERIALS.find((material) => material.code === code) as MaterialRow;
}

async function seedEstimate(client: PoolClient, pieceId: string, town: Town, title: string, signedAt: Date | null): Promise<string | null> {
  const plan = SEED_ESTIMATES[title];
  if (!plan) return null;
  const { currency, taxPercent } = TOWNS[town];
  const key = priceKey(currency);
  const material = materialOf(plan.code);
  const hides = hidesNeeded(SEED_AREA, plan.averageSqFt);
  const rateMinor = minorOfPrice(STARTING_RATE[key], currency);
  const figures = workOutFigures(leatherAmount(hides, plan.averageSqFt, material.prices[key]), plan.hours, rateMinor, currency, taxPercent);
  const id = randomUUID();
  await client.query(
    `INSERT INTO estimates (id, piece_id, version, state, currency, material_code, material_name, lot, pattern_area_sq_ft, hides, labour_hours,
       labour_rate_minor, material_minor, labour_minor, subtotal_minor, tax_percent, tax_minor, total_minor, created_at)
     VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, COALESCE($18, now()))`,
    [id, pieceId, signedAt ? "signedOff" : "open", currency, plan.code, material.name, plan.lot, SEED_AREA, hides, plan.hours,
      figures.labourRateMinor, figures.materialMinor, figures.labourMinor, figures.subtotalMinor, figures.taxPercent, figures.taxMinor, figures.totalMinor, signedAt],
  );
  return id;
}

async function seedPhotographs(client: PoolClient, pieceId: string, title: string): Promise<void> {
  for (const [index, side] of (["before", "after"] as const).entries()) {
    const file = seedPhotograph(title, side);
    const id = randomUUID();
    await client.query(
      "INSERT INTO photographs (id, piece_id, number, side, sha256, bytes, state) VALUES ($1, $2, $3, $4, $5, $6, 'waiting')",
      [id, pieceId, index + 1, side, createHash("sha256").update(file).digest("hex"), file.length],
    );
    await client.query("INSERT INTO seed_files (kind, ref) VALUES ('photograph', $1)", [id]);
  }
}

async function seedPiece(client: PoolClient, deskIds: Record<keyof typeof DESKS, string>, start: string, plan: SeedPiece, signedAt: Date): Promise<string> {
  const clientId = randomUUID();
  const pieceId = randomUUID();
  await client.query(
    "INSERT INTO clients (id, desk_id, name, town, language, email) VALUES ($1, $2, $3, $4, $5, $6)",
    [clientId, deskIds[plan.desk], plan.client, plan.town, plan.language, plan.email],
  );
  await client.query(
    `INSERT INTO pieces (id, desk_id, client_id, title, maker, year, stamp_number, width_cm, depth_cm, height_cm, weight_kg, due_date, state, last_pin_number)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 3)`,
    [pieceId, deskIds[plan.desk], clientId, plan.title, plan.maker, plan.year, plan.stamp, ...plan.size, addDays(start, plan.dueDays), plan.state],
  );
  for (const pin of SEED_PINS) {
    await client.query(
      "INSERT INTO pins (id, piece_id, number, x_tenths, y_tenths, kind, note, signed) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      [randomUUID(), pieceId, pin.number, pin.x, pin.y, pin.kind, pin.note, pin.signed],
    );
  }
  await client.query("INSERT INTO layouts (piece_id, placements) VALUES ($1, $2)", [pieceId, JSON.stringify([{ name: "Seat", x: 0, y: 0, rotation: 0 }])]);
  await seedPhotographs(client, pieceId, plan.title);
  await seedEstimate(client, pieceId, plan.town, plan.title, plan.title === "Bentwood armchair" ? signedAt : null);
  return pieceId;
}

async function seedHold(client: PoolClient, pieceId: string, code: string, lot: string, quantity: string, holdId: string, endsOn: string): Promise<void> {
  await client.query(
    "INSERT INTO holds (id, piece_id, code, lot, quantity, hold_id, ends_on) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [randomUUID(), pieceId, code, lot, quantity, holdId, endsOn],
  );
}

async function seedCollection(client: PoolClient, pieceId: string, id: string, localDate: string): Promise<void> {
  const town: Town = "New York";
  await client.query(
    `INSERT INTO collections (id, piece_id, quote_id, repeat_key, courier_id, state, collect_at, local_date, local_time, town)
     VALUES ($1, $2, $3, $4, $1, 'waiting', $5, $6, '09:00', $7)`,
    [id, pieceId, `Q-${id}`, `seed-${id}`, wallInstant(localDate, "09:00", TOWNS[town].zone), localDate, town],
  );
  await client.query("INSERT INTO seed_files (kind, ref) VALUES ('label', $1)", [id]);
}

async function seedSignedDossier(client: PoolClient, pieceId: string, signedAt: Date): Promise<void> {
  const estimate = await one<{ id: string }>("SELECT id FROM estimates WHERE piece_id = $1", [pieceId], client);
  const signer = DESKS.agnese.name;
  await client.query(
    "INSERT INTO dossiers (id, piece_id, estimate_id, state, signed_by, signed_at, created_at) VALUES ($1, $2, $3, 'waiting', $4, $5, $5)",
    [randomUUID(), pieceId, estimate?.id, signer, signedAt],
  );
  for (const [index, what] of ["asked", "rendered", "stored", "signed"].entries()) {
    await client.query("INSERT INTO dossier_history (piece_id, at, who, what) VALUES ($1, $2, $3, $4)", [pieceId, addSeconds(signedAt, index * 60), signer, what]);
  }
  await client.query("INSERT INTO seed_files (kind, ref) VALUES ('dossier', $1)", [pieceId]);
}

async function seedClientSignOff(client: PoolClient, pieceId: string, signedAt: Date, dueDate: string): Promise<void> {
  const estimate = await one<{ id: string }>("SELECT id FROM estimates WHERE piece_id = $1", [pieceId], client);
  const sentAt = addSeconds(signedAt, -86_400);
  const dueEnd = wallInstant(dueDate, "23:59:59", TOWNS.London.zone) as Date;
  const lifetimeEnd = addSeconds(sentAt, config.clientPageSeconds);
  await client.query(
    `INSERT INTO client_pages (token, piece_id, language, sent_at, ends_at, signed_name, signed_at, signed_estimate_id)
     VALUES ($1, $2, 'en', $3, $4, 'Zoë Ørsted', $5, $6)`,
    [randomBytes(24).toString("base64url"), pieceId, sentAt, dueEnd < lifetimeEnd ? dueEnd : lifetimeEnd, signedAt, estimate?.id],
  );
}

/** The published starting records, once, on an empty database, with dates from the Turin date the copy starts. */
export async function seed(client: PoolClient): Promise<void> {
  if (await one("SELECT 1 FROM desks LIMIT 1", [], client)) return;
  const start = turinToday();
  const signedAt = wallInstant(addDays(start, -1), "12:00", TURIN_ZONE) as Date;
  const deskIds = { agnese: randomUUID(), ruben: randomUUID() };
  for (const [key, desk] of Object.entries(DESKS) as [keyof typeof DESKS, (typeof DESKS)[keyof typeof DESKS]][]) {
    await query("INSERT INTO desks (id, name, email, password_hash) VALUES ($1, $2, $3, $4)", [deskIds[key], desk.name, desk.email, await hashPassword(desk.password)], client);
    await seedDeskStart(client, deskIds[key]);
  }
  const pieceIds = new Map<string, string>();
  for (const plan of SEED_PIECES) pieceIds.set(plan.title, await seedPiece(client, deskIds, start, plan, signedAt));
  const piece = (title: string): string => pieceIds.get(title) as string;

  await seedHold(client, piece("Lounge chair"), "VM-2041", "L-2041-A", "2", "H-6001", addDays(start, 1));
  await seedHold(client, piece("Tubular armchair"), "VM-2044", "L-2044-A", "1", "H-6002", addDays(start, -1));

  const change = nextClockChange(TOWNS["New York"].zone, start);
  const lastMonday = mondayOf(addDays(change, -1));
  await seedCollection(client, piece("Cantilever side chair"), "C-8001", lastMonday);
  await seedCollection(client, piece("Cantilever side chair"), "C-8002", addDays(mondayOf(change), 7));

  const bentwood = piece("Bentwood armchair");
  await seedClientSignOff(client, bentwood, signedAt, addDays(start, 14));
  await seedSignedDossier(client, bentwood, signedAt);

  const monday = mondayOf(start);
  await client.query("INSERT INTO bench_jobs (id, desk_id, piece_id, bench, day) VALUES ($1, $2, $3, 'frame', $4)", [randomUUID(), deskIds.agnese, piece("Lounge chair"), monday]);
  await client.query("INSERT INTO bench_jobs (id, desk_id, piece_id, bench, day) VALUES ($1, $2, $3, 'cover', $4)", [randomUUID(), deskIds.agnese, piece("Tubular armchair"), addDays(monday, 2)]);
}
